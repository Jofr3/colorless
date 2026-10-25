#!/usr/bin/env bun
/**
 * Fails when a TypeScript file in the repo is not covered by any `tsc -b` project. Run with `bun
 * run typecheck:coverage`; it is also a step of `bun run check`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { expandedCheckScript, fail, isRecord, linesWithOverflow, parseJson } from "./lib/cli";
import { localBin, REPO_ROOT, repoSourceFiles } from "./lib/repo";

/** Extensions `tsc` typechecks that hold hand-written source in this repo. */
const EXTENSIONS = ["ts", "tsx", "mts", "cts"];

/** The solution root — the file `bun run typecheck` (`tsc -b`) is pointed at. */
const ROOT_TSCONFIG = "tsconfig.json";

/** This script's own path, as `package.json` must spell it. */
const SELF_PATH = "scripts/typecheck-coverage.ts";

/** Cap the naming so a wholly-emptied config prints a page, not a book. */
const MAX_NAMED = 40;

const REPO = REPO_ROOT;
const TSC = localBin("tsc");

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

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

function isShownConfig(v: unknown): v is ShownConfig {
  return (
    isRecord(v) &&
    (v.files === undefined || isStringArray(v.files)) &&
    (v.references === undefined ||
      (Array.isArray(v.references) &&
        v.references.every((r) => isRecord(r) && typeof r.path === "string")))
  );
}

/**
 * The compiler's own answer for one project: `include`/`files` fully expanded.
 * Nothing is compiled, so this is ~0.1s and safe to run on every `check`.
 */
function showConfig(project: string): ShownConfig {
  const r = spawnSync(TSC, ["-p", project, "--showConfig"], { cwd: REPO, encoding: "utf8" });
  if (r.status !== 0 || !r.stdout.trim()) {
    fail(
      [
        `typecheck-coverage: \`tsc -p ${relative(REPO, project)} --showConfig\` failed `,
        `(exit ${r.status}):\n${r.stdout}${r.stderr}`,
      ].join(""),
    );
  }
  try {
    return parseJson(r.stdout, `--showConfig for ${project}`, isShownConfig);
  } catch (e) {
    fail(`typecheck-coverage: ${String(e)}`);
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
 * Self-check that keeps the guard from going vacuous, for example a predicate blanked to `return
 * []`. Returns the problems found.
 */
export function selfCheck(): string[] {
  const problems: string[] = [];
  const miss = uncoveredIn(["a.ts", "b.ts"], new Set(["a.ts"]));
  if (miss.length !== 1 || miss[0] !== "b.ts") {
    problems.push(
      [
        "typecheck-coverage: SELF-CHECK FAILED — the predicate did not name an ",
        `uncovered file it was handed (got ${JSON.stringify(miss)}, expected ["b.ts"]). `,
        "The guard cannot see a hole, so its verdict on this repo means nothing.",
      ].join(""),
    );
  }
  if (isFullyCovered(["a.ts"], new Set())) {
    problems.push(
      [
        "typecheck-coverage: SELF-CHECK FAILED — a file covered by no project ",
        "was reported as fully covered. The guard is VACUOUS.",
      ].join(""),
    );
  }
  if (!isFullyCovered(["a.ts"], new Set(["a.ts", "z.ts"]))) {
    problems.push(
      [
        "typecheck-coverage: SELF-CHECK FAILED — a fully covered file list was ",
        "reported as uncovered. The guard is RED on every repo, which is not a ",
        "guard either.",
      ].join(""),
    );
  }
  return problems;
}

/**
 * Checks that this guard is still wired into `check` (directly or through the `bun run` scripts it
 * calls), since a guard removed from `check` looks the same as one that passes.
 */
function checkRunsThisGuard(): string[] {
  const check = expandedCheckScript();
  if (!check.includes(SELF_PATH)) {
    return [
      [
        `typecheck-coverage: FAIL — \`${SELF_PATH}\` is not part of the \`check\` `,
        `script in package.json:\n\n  ${check}\n\n`,
        "A coverage guard nothing runs is a coverage guard that always passes.\n",
        "Re-add it (NOT by deleting this rung).",
      ].join(""),
    ];
  }
  return [];
}

function main(): void {
  const problems = [...selfCheck(), ...checkRunsThisGuard()];
  if (problems.length > 0) fail(problems.join("\n"));

  const files = repoSourceFiles(EXTENSIONS);
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

  // No "project contributes zero files" check is needed: `tsc --showConfig` already fails with
  // TS18003 when a project's `include` matches nothing.

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
    return;
  }

  const named = linesWithOverflow(
    uncovered,
    MAX_NAMED,
    (f) => [`  ${f}`],
    (hidden) => `  … and ${hidden} more.`,
  ).join("\n");

  fail(
    [
      `typecheck-coverage: FAIL — ${uncovered.length} of ${files.length} TypeScript file(s) `,
      `are in no project reachable from ${ROOT_TSCONFIG}.\n`,
      "They are typechecked by NOTHING; `tsc -b` exits 0 without ever reading them.\n\n",
      `Files no project can see:\n${named}\n\n`,
      "Fix by widening a project's `include`, or by adding a project to\n",
      `${ROOT_TSCONFIG}'s \`references\` (NOT by deleting this check).\n`,
      "This is D481: `tsc -b` exiting 0 over an empty file set is not coverage.",
    ].join(""),
  );
}

if (import.meta.main) main();
