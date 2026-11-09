#!/usr/bin/env bun
// The API Worker as `wrangler deploy` would upload it, built by a dry run (nothing is uploaded).
// Prints its minified size and the zod locales it carries. `--check` fails when the bundle
// passes `BUDGET_KIB` or carries a zod locale other than English: a single `import { z } from "zod"`
// keeps every locale, where `import * as z from "zod"` lets the bundler drop the unused ones. It
// also fails when the bundle carries a test-only module (`TEST_ONLY`), or a package that is not a
// production dependency of the api, engine or schema workspace (`SHIPPED`): a dev dependency such
// as @tcgdex/sdk is one value import away (dependency audit USE5); a shipped package's own
// dependencies must be declared too, so each one is a reviewed choice. Byte counts only, never
// timings; a step of `check:static`.
//
//   bun scripts/worker-bundle.ts [--check]

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fail, isRecord, parseJson } from "./lib/cli";
import { localBin, repoPath } from "./lib/repo";

/** The minified bundle's ceiling, with room for the engine to grow between reviews of it. */
const BUDGET_KIB = 1024;

const LOCALE = /\/zod\/(?:.*\/)?locales\/([^/]+)\.js$/;

/** The api's test-only modules: its `./testing/*` exports, which other roots' suites import, and
    the fake runtimes they re-export. */
const TEST_ONLY = /(?:^|\/)src\/(?:testing\/[^/]+|[^/]+\/[^/]+Harness)\.ts$/;

/** The workspaces whose `dependencies` may ship in the Worker. */
const SHIPPED = ["apps/api", "packages/engine", "packages/schema"];

/** A store path's package: bun's `node_modules/.bun/@scope+name@version/`, else the segment after
    the last `node_modules/` (a package whose own source map points at its `src/`, like
    drizzle-orm, keeps only the store segment). */
const STORE = /node_modules\/\.bun\/((?:@[^+/]+\+)?[^@/]+)@/;
const HOISTED = /.*node_modules\/((?:@[^/]+\/)?[^/]+)\//;

/** The npm packages behind a source map's `sources`, sorted. */
export function bundledPackages(sources: readonly string[]): string[] {
  const names = new Set<string>();
  for (const source of sources) {
    const name = STORE.exec(source)?.[1]?.replace("+", "/") ?? HOISTED.exec(source)?.[1];
    if (name !== undefined) names.add(name);
  }
  return [...names].sort();
}

/** The production dependencies the Worker may carry: every non-workspace `dependencies` entry of
    the `SHIPPED` workspaces. */
export function shippedDependencies(manifests: readonly unknown[]): Set<string> {
  const names = new Set<string>();
  for (const manifest of manifests) {
    const deps = isRecord(manifest) && isRecord(manifest.dependencies) ? manifest.dependencies : {};
    for (const [name, spec] of Object.entries(deps))
      if (typeof spec !== "string" || !spec.startsWith("workspace:")) names.add(name);
  }
  return names;
}

/** Builds the Worker into a temporary directory and reads its size, its zod locales and the
    test-only modules and npm packages it carries. */
function measure(): { kib: number; locales: string[]; testOnly: string[]; packages: string[] } {
  mkdirSync(repoPath("tmp"), { recursive: true });
  const out = mkdtempSync(join(repoPath("tmp"), "worker-bundle-"));
  try {
    const run = spawnSync(
      localBin("wrangler"),
      ["deploy", "--dry-run", "--minify", "--outdir", out],
      {
        cwd: repoPath("apps/api"),
        encoding: "utf8",
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      },
    );
    if (run.status !== 0)
      throw new Error(`wrangler deploy --dry-run failed:\n${run.stdout}\n${run.stderr}`);
    const map = parseJson(
      readFileSync(join(out, "index.js.map"), "utf8"),
      "index.js.map",
      (v): v is { sources: string[] } => isRecord(v) && Array.isArray(v.sources),
    );
    const locales = map.sources.flatMap((s) => {
      const name = LOCALE.exec(s)?.[1];
      return name === undefined || name === "index" ? [] : [name];
    });
    const testOnly = map.sources.filter((s) => TEST_ONLY.test(s));
    return {
      kib: statSync(join(out, "index.js")).size / 1024,
      locales,
      testOnly,
      packages: bundledPackages(map.sources),
    };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

function main(): void {
  const { kib, locales, testOnly, packages } = measure();
  console.log(
    `worker bundle: ${kib.toFixed(1)} KiB minified (budget ${BUDGET_KIB} KiB); zod locales: ${locales.join(", ") || "none"}; packages: ${packages.join(", ")}.`,
  );
  if (!process.argv.includes("--check")) return;
  const allowed = shippedDependencies(
    SHIPPED.map((dir) =>
      parseJson(
        readFileSync(repoPath(`${dir}/package.json`), "utf8"),
        `${dir}/package.json`,
        isRecord,
      ),
    ),
  );
  const foreign = packages.filter((name) => !allowed.has(name));
  const problems = [
    ...(kib > BUDGET_KIB ? [`the bundle is ${kib.toFixed(1)} KiB, over ${BUDGET_KIB} KiB`] : []),
    ...(locales.some((l) => l !== "en")
      ? [`it carries ${locales.length} zod locales; import zod as \`import * as z from "zod"\``]
      : []),
    ...(testOnly.length > 0 ? [`it carries test-only modules: ${testOnly.join(", ")}`] : []),
    ...(foreign.length > 0
      ? [
          `it carries packages that are not production dependencies of ${SHIPPED.join(", ")}: ${foreign.join(", ")}`,
        ]
      : []),
  ];
  if (problems.length > 0) fail(`worker-bundle: FAIL — ${problems.join("; ")}.`);
}

if (import.meta.main) main();
