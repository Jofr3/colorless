#!/usr/bin/env bun
/**
 * THE TYPECHECK-COVERAGE GUARD (D481) — `bun run typecheck:coverage`, and a
 * step of `bun run check`. D212's twin, eleven months and 269 decisions late.
 *
 * WHY THIS EXISTS. `tsc -b` typechecked NOTHING outside `src`. Every project's
 * `include` was `["src"]` or `["vite.config.ts"]`, so **15 of the repo's 712
 * TypeScript files were checked by no typechecker at all** — the entire
 * mutation corpus (`scripts/mutation/mutants.ts`, 2,238 rows), the runner, both
 * instruments, both instrument gates, `opcoverage.ts`, `precheck.ts`,
 * `recovery-gate.ts`, `splice-gate.ts`, `lint-coverage.ts`,
 * `catalog-manifest.ts`, plus `apps/api/drizzle.config.ts`,
 * `apps/api/scripts/ingest.ts` and `packages/schema/scripts/validate-live.ts`.
 *
 * D480 proved it with a LIVE WITNESS rather than by reading the configs: a
 * declared survivor's reason keyed `survives.why` where the runner reads
 * `survives.reason`, and it shipped GREEN through `bun run check`, surfacing
 * only when a probe printed `undefined`. In a file annotated `MUTANTS:
 * Mutant[]`, that is TS2353 — a two-second error that instead cost a probe
 * round, because the only tool that could see the region was a ~2.7-hour
 * mutation sweep.
 *
 * ⚠️ SO THE HOLE IS NOT "an error slips through" — IT IS WHICH TOOL FINDS IT.
 * A coverage gap in a fast tool is a cost multiplier on the slow one.
 *
 * ⚠️ WHY THIS IS NOT "does `tsc -b` exit 0". That is precisely the check that
 * CANNOT fail, and it is D212's finding one directory over: a project whose
 * `include` matches nothing compiles zero files and exits 0, exactly as `biome
 * lint <path>` exits 0 on a path it processed zero files for. `bun run check`
 * has run `tsc -b` on every slice for a year and was green throughout the hole.
 * **The exit code is not the observation; the FILE LIST is.**
 *
 * HOW. Walk `tsconfig.json`'s `references` transitively — the SAME root
 * `bun run typecheck` builds, so a project this guard can see is a project the
 * build runs — and ask each one `tsc -p <project> --showConfig`, which prints
 * the resolved config with `include` already expanded into `files`. That is the
 * compiler's own answer to "which files are in this project", not a
 * re-implementation of its glob semantics, and it costs ~0.1s per project
 * because nothing is compiled. Then require every TypeScript file the repo
 * tracks to appear in the union.
 *
 * ⚠️ THE PREDICATE IS ROOT FILES, NOT PROGRAM FILES, AND THAT IS DELIBERATE.
 * A file pulled in only by an `import` is typechecked too, so root files are a
 * SUBSET of what `tsc` really checks and this guard can over-report a gap but
 * never under-report one. Conservative is the correct direction for a coverage
 * check: the failure it exists to prevent is a file silently leaving the build,
 * and being told about a file that is covered-by-import costs one line of
 * config, while the reverse costs a sweep. (Measured at D481: the two sets are
 * equal — nothing in this repo is covered by import alone.)
 *
 * ⚠️ IT HOLDS NO NUMBER OF ITS OWN (D465). The file list comes from `git`, the
 * project list comes from `tsconfig.json`, and the per-project file lists come
 * from `tsc`. There is no literal here to drift out of step with the repo,
 * which is what rotted the prose that used to assert this coverage.
 *
 * ⚠️ AND THERE IS NO EXEMPTION LIST — asserted, not merely absent. An
 * exemption list is where a coverage guard goes to die: the first file added to
 * it is always justified and the tenth is never re-read. If a file genuinely
 * cannot be typechecked, it belongs in a project with the compiler options that
 * let it be, not in an allowlist here.
 *
 * ⚠️ WHAT IT DOES NOT COVER, STATED. Script extensions only, and only what
 * `git` tracks or would track (so `node_modules`, `dist` and `tmp/` stay out).
 * It says nothing about whether the compiler OPTIONS are strict enough — a
 * project with `strict: false` passes this guard — only about whether there is
 * a source file no project can see. And it cannot tell you that a project's
 * options are the RIGHT ones for its files; that is what the errors are for.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/** Extensions `tsc` typechecks that hold hand-written source in this repo. */
const EXTENSIONS = ["ts", "tsx", "mts", "cts"];

/** The solution root — the file `bun run typecheck` (`tsc -b`) is pointed at. */
const ROOT_TSCONFIG = "tsconfig.json";

/** This script's own path, as `package.json` must spell it. */
const SELF_PATH = "scripts/typecheck-coverage.ts";

/** Cap the naming so a wholly-emptied config prints a page, not a book. */
const MAX_NAMED = 40;

const REPO = process.cwd();
const TSC = existsSync("node_modules/.bin/tsc") ? "node_modules/.bin/tsc" : "tsc";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/**
 * Every TypeScript file the repo holds: tracked files plus untracked ones
 * `.gitignore` does not cover, so a brand-new module is covered the moment it
 * lands rather than the moment somebody remembers to commit it.
 */
function sourceFiles(): string[] {
  const patterns = EXTENSIONS.map((e) => `*.${e}`);
  const git = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...patterns],
    { encoding: "utf8" },
  );
  if (git.status !== 0) fail(`typecheck-coverage: git ls-files failed:\n${git.stderr}`);
  const seen = new Set(git.stdout.split("\0").filter(Boolean));
  return [...seen].filter((f) => existsSync(f) && statSync(f).isFile()).sort();
}

/**
 * A `references` entry is a path to a tsconfig OR to a directory holding one —
 * `tsc`'s own rule, reproduced here because the two spellings are both in use
 * (`./tsconfig.app.json` and `./apps/api`).
 */
function resolveProject(p: string): string {
  const abs = resolve(REPO, p);
  if (existsSync(abs) && statSync(abs).isDirectory()) return join(abs, "tsconfig.json");
  return abs;
}

type ShownConfig = {
  files?: string[];
  references?: { path: string }[];
};

/**
 * The compiler's own answer for one project: `include`/`files` fully expanded.
 * Nothing is compiled, so this is ~0.1s and safe to run on every `check`.
 */
function showConfig(project: string): ShownConfig {
  const r = spawnSync(TSC, ["-p", project, "--showConfig"], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout.trim()) {
    fail(
      [
        `typecheck-coverage: \`tsc -p ${relative(REPO, project)} --showConfig\` failed `,
        `(exit ${r.status}):\n${r.stdout}${r.stderr}`,
      ].join(""),
    );
  }
  try {
    return JSON.parse(r.stdout) as ShownConfig;
  } catch (e) {
    fail(`typecheck-coverage: could not parse --showConfig for ${project}:\n${String(e)}`);
  }
}

/** Walk the solution depth-first, collecting each project's root file set. */
function projectFileSets(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const queue = [resolveProject(ROOT_TSCONFIG)];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const project = queue.shift();
    if (project === undefined || visited.has(project)) continue;
    visited.add(project);
    if (!existsSync(project)) {
      fail(
        [
          `typecheck-coverage: ${relative(REPO, project)} is referenced by the solution `,
          "but does not exist.",
        ].join(""),
      );
    }
    const cfg = showConfig(project);
    const base = dirname(project);
    const files = new Set((cfg.files ?? []).map((f) => relative(REPO, resolve(base, f))));
    // The solution root itself is `files: []` by design; only leaves count.
    if (files.size > 0) out.set(relative(REPO, project), files);
    for (const ref of cfg.references ?? []) queue.push(resolveProject(join(base, ref.path)));
  }
  return out;
}

/** The files no project can see. The whole verdict is this one line. */
function uncoveredIn(files: readonly string[], covered: ReadonlySet<string>): string[] {
  return files.filter((f) => !covered.has(f));
}

/** The verdict itself, as a boolean, so the comparison is drivable too. */
function isFullyCovered(files: readonly string[], covered: ReadonlySet<string>): boolean {
  return uncoveredIn(files, covered).length === 0;
}

/**
 * ⚠️ THE SELF-CHECK, AND IT IS THE REASON THIS GUARD IS NOT THE DEFECT IT
 * GUARDS AGAINST (D481, applying D465 and D479).
 *
 * A coverage guard has one failure mode that its own subject cannot reveal:
 * going VACUOUS. Blank the predicate to `return []`, or widen `=== 0` to
 * `<= 1`, and the guard reports OK on every repo including a broken one — it
 * passes, forever, and a passing guard is a verdict this run treats as
 * informative. **The danger of an unkillable check is not that it fails; it is
 * that it PASSES.** Nothing else in the repo can contradict it: `tsc -b` is the
 * thing it audits, and a mutation sweep that mutates this file would report
 * SURVIVED and be believed.
 *
 * So the predicate is driven on two synthetic pairs where the right answer is
 * known by construction, before it is ever pointed at the repo. This is a BOARD
 * on which the guard's absence is observable, which is the only thing that
 * makes a mutant row against it a row rather than a decoration.
 */
function selfCheck(): void {
  const miss = uncoveredIn(["a.ts", "b.ts"], new Set(["a.ts"]));
  if (miss.length !== 1 || miss[0] !== "b.ts") {
    fail(
      [
        "typecheck-coverage: SELF-CHECK FAILED — the predicate did not name an ",
        `uncovered file it was handed (got ${JSON.stringify(miss)}, expected ["b.ts"]). `,
        "The guard cannot see a hole, so its verdict on this repo means nothing.",
      ].join(""),
    );
  }
  if (isFullyCovered(["a.ts"], new Set())) {
    fail(
      [
        "typecheck-coverage: SELF-CHECK FAILED — a file covered by no project ",
        "was reported as fully covered. The guard is VACUOUS.",
      ].join(""),
    );
  }
  if (!isFullyCovered(["a.ts"], new Set(["a.ts", "z.ts"]))) {
    fail(
      [
        "typecheck-coverage: SELF-CHECK FAILED — a fully covered file list was ",
        "reported as uncovered. The guard is RED on every repo, which is not a ",
        "guard either.",
      ].join(""),
    );
  }
}

/**
 * ⚠️ THE WIRING RUNG — D212's guard does not have this one, and the gap is
 * real. `lint-coverage.ts` is a perfect check that can be switched off by
 * deleting eight words from `package.json`, and nothing goes red. A guard
 * removed from `check` is indistinguishable from a guard that passes.
 *
 * So this script asserts its own presence in the command `check` runs. It is
 * the cheapest possible rung — one `includes` over one string — and it is the
 * only thing standing between this slice and the next config edit that quietly
 * un-runs it.
 */
function checkRunsThisGuard(): void {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };
  const check = pkg.scripts?.check ?? "";
  if (!check.includes(SELF_PATH)) {
    fail(
      [
        `typecheck-coverage: FAIL — \`${SELF_PATH}\` is not part of the \`check\` `,
        `script in package.json:\n\n  ${check}\n\n`,
        "A coverage guard nothing runs is a coverage guard that always passes.\n",
        "Re-add it (NOT by deleting this rung).",
      ].join(""),
    );
  }
}

selfCheck();
checkRunsThisGuard();

const files = sourceFiles();
if (files.length === 0) {
  fail("typecheck-coverage: found no TypeScript files at all — that cannot be right.");
}

const sets = projectFileSets();
if (sets.size === 0) {
  fail(
    [
      `typecheck-coverage: FAIL — ${ROOT_TSCONFIG} reaches no project that contains a file.\n`,
      "Every TypeScript file in this repo is typechecked by NOTHING.",
    ].join(""),
  );
}

// ⚠️ THERE IS DELIBERATELY NO "this project contributes zero files" RUNG HERE,
// and the reason is a probe rather than an opinion (D481). One was written and
// then DELETED as unreachable: a project whose `include` matches nothing makes
// `tsc -p … --showConfig` itself exit 1 with TS18003 ("No inputs were found in
// config file"), so `showConfig` above fails first and this code could never
// run. The vacuous-config case IS caught — by the compiler, one call earlier —
// and a rung that cannot fire is not a weaker guard, it is not a guard.

const covered = new Set<string>();
for (const [, s] of sets) for (const f of s) covered.add(f);

const uncovered = uncoveredIn(files, covered);
if (isFullyCovered(files, covered)) {
  const projects = [...sets.keys()].sort().join(", ");
  console.log(
    [
      `typecheck-coverage: OK — all ${files.length} TypeScript files are in ${sets.size} `,
      `project(s) of ${ROOT_TSCONFIG} (${projects}).`,
    ].join(""),
  );
  process.exit(0);
}

const named = uncovered.slice(0, MAX_NAMED).map((f) => `  ${f}`).join("\n");
const more =
  uncovered.length > MAX_NAMED ? `\n  … and ${uncovered.length - MAX_NAMED} more.` : "";

fail(
  [
    `typecheck-coverage: FAIL — ${uncovered.length} of ${files.length} TypeScript file(s) `,
    `are in no project reachable from ${ROOT_TSCONFIG}.\n`,
    "They are typechecked by NOTHING; `tsc -b` exits 0 without ever reading them.\n\n",
    `Files no project can see:\n${named}${more}\n\n`,
    "Fix by widening a project's `include`, or by adding a project to\n",
    `${ROOT_TSCONFIG}'s \`references\` (NOT by deleting this check).\n`,
    "This is D481: `tsc -b` exiting 0 over an empty file set is not coverage.",
  ].join(""),
);
