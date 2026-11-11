#!/usr/bin/env bun
/**
 * Brings every committed generated file up to date, one generator after another: the Lua
 * constants, the three files read from the local D1 catalog, the decision index and the Worker's
 * types. Each runs its check first and rewrites only when that fails, so a current file keeps its
 * provenance stamps. Without a local D1 the catalog generators are skipped and named. It ends by
 * printing the one step it leaves to you, the Lua wire fixtures, since `-u` accepts whatever the
 * adapters now send.
 *
 *   bun run gen
 */

import { spawnSync } from "node:child_process";
import { findLocalD1 } from "./lib/localD1";
import { REPO_ROOT } from "./lib/repo";

/** A generator: what it writes, its check and its rewrite. `catalog` ones read the local D1. */
export type GenStep = {
  writes: string;
  check: readonly string[];
  write: readonly string[];
  catalog: boolean;
};

const script = (writes: string, path: string, catalog = false): GenStep => ({
  writes,
  check: ["bun", path, "--check"],
  write: ["bun", path],
  catalog,
});

export const GEN_STEPS: readonly GenStep[] = [
  script("Lua constants", "scripts/lua-constants.ts"),
  script("reprint aliases", "scripts/registry-aliases.ts", true),
  script("catalog manifest", "scripts/catalog-manifest.ts", true),
  script("census corpora", "scripts/census-corpus.ts", true),
  script("decision index", "scripts/decision-index.ts"),
  {
    writes: "Worker types",
    check: ["bun", "scripts/worker-types.ts"],
    write: ["bun", "run", "--cwd", "apps/api", "types"],
    catalog: false,
  },
];

export const WIRE_FIXTURES_STEP =
  "If the Lua wire changed, review and run: bunx vitest run src/lua/wireFixtures.test.ts -u";

/** The steps to run, and the ones skipped for want of a local D1. */
export function plannedSteps(hasCatalog: boolean): { run: GenStep[]; skipped: GenStep[] } {
  return {
    run: GEN_STEPS.filter((step) => hasCatalog || !step.catalog),
    skipped: GEN_STEPS.filter((step) => !hasCatalog && step.catalog),
  };
}

/** Runs `argv` from the repo root; whether it exited 0. */
function succeeds(argv: readonly string[], quiet: boolean): boolean {
  const [command = "", ...args] = argv;
  const result = spawnSync(command === "bun" ? process.execPath : command, args, {
    cwd: REPO_ROOT,
    stdio: quiet ? "ignore" : "inherit",
  });
  return result.status === 0;
}

/**
 * Each step's check, then its rewrite when the check fails; the steps whose rewrite failed.
 * `run` is injected by tests.
 */
export function regenerate(
  steps: readonly GenStep[],
  run: (argv: readonly string[], quiet: boolean) => boolean = succeeds,
): string[] {
  const failed: string[] = [];
  for (const step of steps) {
    if (run(step.check, true)) {
      console.log(`gen: ${step.writes} current.`);
      continue;
    }
    console.log(`gen: ${step.writes} stale: ${step.write.join(" ")}`);
    if (!run(step.write, false)) failed.push(step.writes);
  }
  return failed;
}

function main(): number {
  const { run, skipped } = plannedSteps(findLocalD1() !== undefined);
  const failed = regenerate(run);
  for (const step of skipped) console.log(`gen: ${step.writes} SKIPPED — no local D1 catalog.`);
  console.log(WIRE_FIXTURES_STEP);
  if (failed.length > 0) {
    console.error(`gen: failed: ${failed.join(", ")}`);
    return 1;
  }
  return 0;
}

if (import.meta.main) process.exit(main());
