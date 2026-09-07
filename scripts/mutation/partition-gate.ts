/**
 * 🆕🆕 D484 — THE PARTITION GATE: NO TWO ROWS MAY BE THE SAME EXPERIMENT.
 *
 * WHY THIS EXISTS, AND IT IS A LIVE WITNESS RATHER THAN A WORRY. D483 found two
 * mutant rows whose `find` strings both resolved to the SAME LINE of
 * `effects.ts`. D447 re-indexed a capture group and only one of the two rows
 * quoting that line was re-transcribed; the other landed on its neighbour's
 * line and stayed there. **Both reported KILLED on every sweep for 46
 * decisions, and the gated arm one of them names had no row at all.**
 *
 * 🛑 `precheck` WAS TRUE THE WHOLE TIME. It asserts *"every `find` occurs
 * exactly once in its target"* — and it does: each find occurred once, and both
 * pointed at the same line. **A per-row uniqueness check does not imply a
 * per-line partition, and until this file nothing asserted the second.**
 *
 * ─── WHY THE PREDICATE IS NOT "NO LINE CARRIES TWO ROWS" ──────────────────────
 * ⚠️ **BECAUSE THAT WAS MEASURED AND IT IS FALSE BY A FACTOR OF HUNDREDS.**
 * D484 grouped all 2,267 rows by the (file, resolved line) their `find` lands
 * on: **383 lines carry more than one row, over 943 rows — 41.6% of the
 * corpus.** (Those are the figures for the corpus AS MEASURED, before this
 * slice's own 13 rows; they are a dated finding, not an invariant, and nothing
 * below asserts them.) Sharing a line is not a defect here, it is the corpus's central
 * idiom: one anchor line, N different corruptions of it (`D407-board-zone-*` is
 * four rows on `attack.ts:416`; `D475-flip-count-*` is five). Two narrower
 * predicates were measured and rejected the same way:
 *
 *   - *no two rows share a `find`* — refuted: **292 groups, 724 rows.**
 *   - *no two rows share a `(file, find, replace)`* — refuted: **4 groups, 8
 *     rows**, and all four are deliberate and documented in their own `what`
 *     fields. `D316-yes-arm-loses-the-bonus` says it outright: re-pointed into
 *     the shared `boostedArms`, *"so this row and its D317 twin are now the SAME
 *     mutation with two different killers — which is the point rather than a
 *     duplicate: the arm is shared, so it owes a kill from each sentence."*
 *     `D280-allOf-folds-with-some` / `D365-allof-fold-turns-disjunctive` is the
 *     same shape across a registry/derived-sentence boundary.
 *
 * ─── SO THE PREDICATE IS EXPERIMENT IDENTITY ─────────────────────────────────
 * Two rows are a defect when they are **indistinguishable to the runner**: same
 * `file`, same `find`, same `replace`, same `nameFilter`, same killers
 * (`expectKilledBy` as a SET, or `killedByCommand`), same `survives`. Such a
 * pair is one experiment executed twice and reported as two, so **at least one
 * of them is not testing what its `what` names** — which is exactly D483's
 * defect and exactly what makes it invisible in the verdict column. `id`,
 * `decision` and `what` are deliberately NOT in the key: they are labels, and a
 * defect that renames itself is still a defect.
 *
 * 🛑 **AND THE PREDICATE WAS VALIDATED AGAINST HISTORY, NOT PROPOSED.** Run
 * against the corpus as it stood at six commits spanning the whole window:
 *
 *     D437  1,699 rows → 0 groups      (before the re-index)
 *     D447  1,820 rows → 1 group       ← the defect enters, at the commit that caused it
 *     D455  1,933 rows → 1 group
 *     D465  2,053 rows → 1 group
 *     D475  2,178 rows → 1 group
 *     D482  2,255 rows → 1 group       (the sweep before D483 found it by hand)
 *     HEAD  2,267 rows → 0 groups      (after D483's repair)
 *
 * The one group is `D437-reader-drops-the-narrowing` +
 * `D437-gated-caller-drops-the-widening`, every time, and nothing else ever.
 * **Zero false positives across 46 decisions and 568 rows added over the
 * window.** That is the whole argument for this exact key: it is a detector with
 * a measured miss rate of zero on the defect it was built for and a measured
 * false-positive rate of zero on the corpus that carried it.
 *
 * ─── AND THERE IS NO EXEMPTION LIST — ASSERTED, NOT MERELY ABSENT ────────────
 * The four legitimate shared-patch pairs are admitted BY THE KEY (they differ in
 * their killers), not by being named here. An exemption list is where a corpus
 * guard goes to die: the first entry is always justified and the tenth is never
 * re-read. If a future pair is genuinely two experiments, it will differ in
 * something the runner can see — and if it differs in nothing the runner can
 * see, it is not two experiments.
 *
 * ─── WHAT IT DOES NOT COVER, STATED ──────────────────────────────────────────
 * ⚠️ It cannot see a row that points at the WRONG line while remaining
 * distinguishable — D483's pair was caught because the mis-pointed row collided
 * with its neighbour's row, and a mis-pointing onto a line no row occupies
 * leaves no trace here. Nothing mechanical can settle that; only the
 * three-field read (`find`/`replace`/`what`) can, which is why that convention
 * stands beside this file rather than being replaced by it. **A mutation corpus
 * reports what its rows do, never what its rows say they do.**
 *
 * ─── WHY A SCRIPT, AND WHY NOT INSIDE `precheck.ts` ──────────────────────────
 * `scripts/**` is outside vitest's globs, so a guard over the harness is named
 * from a mutant row's `killedByCommand` (D212's precedent; D411's recovery gate
 * and D470's splice gate are the second and third). And it is its OWN file for
 * D470's attribution reason: `precheck.ts` exits 1 whenever any row's `find`
 * moves, so a guard living inside it would be over-determined for every mutant
 * that touches a corpus row. This file has no `find` check in it, so a red here
 * is attributable. `precheck.ts` imports `partitionReport()` so the command
 * everyone actually runs before a sweep still reports it — and the wiring rung
 * below asserts that it does.
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
 * ⚠️ THE RUNNER-VISIBLE IDENTITY OF A ROW, AND EVERY FIELD IN IT IS HERE FOR A
 * REASON THE SELF-CHECK DRIVES.
 *
 * `expectKilledBy` is sorted because the runner passes it to `vitest` as a
 * positional filter and the order does not change which suites run — two rows
 * that name the same suites in different order are the same experiment, and a
 * key that missed that would be a hole an author could fall into by accident.
 * `id`, `decision` and `what` are absent: they are how a human refers to the
 * row, not what the machine does with it.
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
 * ⚠️ THE SELF-CHECK, AND IT IS THE REASON A MUTANT AGAINST THIS FILE IS A ROW
 * RATHER THAN A DECORATION (D481, applying D465 and D479).
 *
 * A corpus guard that asserts "the duplicate set is empty" has one failure mode
 * its own subject cannot reveal: going VACUOUS. Drop a field from the key,
 * widen `> 1` to `> 2`, return `[]`. All of those stay GREEN on this repo and on
 * a broken one, and **a mutation against a vacuous guard reports SURVIVED,
 * which this corpus treats as informative.** The danger of an unkillable rung is
 * not that it fails — it is that it PASSES.
 *
 * So the predicate is driven on synthetic pairs whose answer is known BY
 * CONSTRUCTION before the real corpus is consulted. Each pair differs in
 * exactly one field, so a key that stops reading that field reddens HERE, on a
 * board built for it, rather than depending on the accident of whether today's
 * corpus happens to contain such a pair. **This is the board on which this
 * guard's own absence is observable.**
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
  if (isPartitioned(twins)) bad("a corpus containing D483's exact defect was reported PARTITIONED.");

  // 2. The negative cases: one field apart is two experiments, not one. Each of
  //    these is a rung that goes red if that field leaves `experimentKey`.
  const apart: [string, Mutant[]][] = [
    ["file", [row({ id: "one" }), row({ id: "two", file: "b.ts" })]],
    ["find", [row({ id: "one" }), row({ id: "two", find: "const y = 1;" })]],
    ["replace", [row({ id: "one" }), row({ id: "two", replace: "const x = 3;" })]],
    ["nameFilter", [row({ id: "one" }), row({ id: "two", nameFilter: "some test" })]],
    ["expectKilledBy", [row({ id: "one" }), row({ id: "two", expectKilledBy: ["b.test.ts"] })]],
    // ⚠️ BOTH SIDES CARRY A COMMAND, AND THAT IS A REPAIR RATHER THAN A STYLE
    //    CHOICE (D484's own probe). This rung was first written as "no command"
    //    versus "a command", which also flips `expectKilledBy` from a suite to
    //    `[]` — so it stayed green with `killedByCommand` REMOVED from the key,
    //    and the row that names that mutation reported SURVIVED. **An
    //    over-determined rung is a rung that cannot fire for its own reason**
    //    (D416), and here it made the mutant unkillable-as-written (D479) while
    //    looking guarded. One field apart, or the board proves nothing.
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
  if (sharedPatchGroups([row({ id: "one" }), row({ id: "two", find: "const y = 1;" })]).length > 0) {
    bad("the shared-patch population counted two rows that patch different text.");
  }
}

/**
 * ⚠️ THE WIRING RUNG — D212's guard does not have one and the gap is real. A
 * gate nothing calls is indistinguishable from a gate that passes, and
 * `lint-coverage.ts` can still be switched off by deleting eight words from
 * `package.json` with nothing going red.
 *
 * This gate's home is `precheck.ts`, not `package.json`: `bun run check` is
 * green with a broken corpus by design, and the command that precedes every
 * sweep is `bun scripts/mutation/precheck.ts`. So the rung asserts the call is
 * in that file — one `includes` over one string, and the only thing standing
 * between this slice and the next tidy-up that quietly un-runs it.
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
    groups.length > MAX_NAMED ? [`   … and ${String(groups.length - MAX_NAMED)} more group(s).`] : [];

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
