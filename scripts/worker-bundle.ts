#!/usr/bin/env bun
// The API Worker as `wrangler deploy` would upload it, built by a dry run (nothing is uploaded)
// with the flags of the apps/api `deploy` script, so it measures what ships. Prints its size and
// the zod locales it carries. `--check` fails when the `deploy` script does not minify or
// apps/api/wrangler.jsonc does not upload source maps (which Workers Logs needs to resolve a
// minified stack trace to source; dependency audit USE1), and when the bundle passes `BUDGET_KIB`
// or carries a zod locale other than English: a single `import { z } from "zod"`
// keeps every locale, where `import * as z from "zod"` lets the bundler drop the unused ones. It
// also fails when the bundle carries a test-only module (`TEST_ONLY`), or a package that is not a
// production dependency of the api, engine or schema workspace (`SHIPPED`): a dev dependency such
// as @tcgdex/sdk is one value import away (dependency audit USE5); a shipped package's own
// dependencies must be declared too, so each one is a reviewed choice. Byte counts only, never
// timings; a step of `check:static`.
//
//   bun scripts/worker-bundle.ts [--check]

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fail, isRecord, parseJson } from "./lib/cli";
import { localBin, repoPath } from "./lib/repo";

/** The deployed (minified) bundle's ceiling, with room for the engine to grow between reviews of
    it. */
const BUDGET_KIB = 1024;

const LOCALE = /\/zod\/(?:.*\/)?locales\/([^/]+)\.js$/;

/** The api's test-only modules: its `./testing/*` exports, which other roots' suites import, and
    the fake runtimes they re-export. */
const TEST_ONLY = /(?:^|\/)src\/(?:testing\/[^/]+|[^/]+\/[^/]+Harness)\.ts$/;

/** The workspaces whose `dependencies` may ship in the Worker. */
export const SHIPPED = ["apps/api", "packages/engine", "packages/schema"];

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

/** The flags the `deploy` script passes to `wrangler deploy`, from the `&&`-joined step that runs
    it, or undefined when no step does. The step is `wrangler deploy <flags>` itself, or a
    release-gate run that ends in `-- wrangler deploy <flags>`, which runs it after its gates and
    adds the commit's `--tag` and `--message` (scripts/release-gate.ts; those two only label the
    version, so the dry run goes without them). */
export function deployFlags(script: string): string[] | undefined {
  for (const step of script.split("&&")) {
    const words = step.trim().split(/\s+/);
    const dash = words.indexOf("--");
    const command = words[0] === "wrangler" ? words : dash >= 0 ? words.slice(dash + 1) : [];
    if (command[0] === "wrangler" && command[1] === "deploy") return command.slice(2);
  }
  return undefined;
}

/** Whether a wrangler.jsonc sets `"upload_source_maps": true` on a line of its own (a
    commented-out line does not count). */
export function uploadsSourceMaps(config: string): boolean {
  return /^\s*"upload_source_maps"\s*:\s*true\b/m.test(config);
}

/** What `--check` refuses in the deploy itself: a `deploy` script that does not run
    `wrangler deploy --minify` (the budget would gate a bundle that never ships), or a config that
    does not upload the source maps a minified bundle's stack traces need. */
export function deployProblems(
  flags: readonly string[] | undefined,
  sourceMaps: boolean,
): string[] {
  const minify =
    flags === undefined
      ? ["the apps/api `deploy` script runs no `wrangler deploy` step"]
      : flags.includes("--minify")
        ? []
        : ["the apps/api `deploy` script runs `wrangler deploy` without `--minify`"];
  return [
    ...minify,
    ...(sourceMaps ? [] : ['apps/api/wrangler.jsonc does not set `"upload_source_maps": true`']),
  ];
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

/** Builds the Worker into a temporary directory with the `deploy` script's flags and reads its
    size, its zod locales and the test-only modules and npm packages it carries. */
function measure(flags: readonly string[]): {
  kib: number;
  locales: string[];
  testOnly: string[];
  packages: string[];
} {
  mkdirSync(repoPath("tmp"), { recursive: true });
  const out = mkdtempSync(join(repoPath("tmp"), "worker-bundle-"));
  try {
    const run = spawnSync(
      localBin("wrangler"),
      ["deploy", ...flags, "--dry-run", "--outdir", out],
      {
        cwd: repoPath("apps/api"),
        encoding: "utf8",
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
      },
    );
    if (run.status !== 0)
      throw new Error(`wrangler deploy --dry-run failed:\n${run.stdout}\n${run.stderr}`);
    if (!existsSync(join(out, "index.js.map")))
      throw new Error('the dry run wrote no index.js.map; set "upload_source_maps": true');
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
  const manifests = SHIPPED.map((dir) =>
    parseJson(
      readFileSync(repoPath(`${dir}/package.json`), "utf8"),
      `${dir}/package.json`,
      isRecord,
    ),
  );
  // SHIPPED[0] is apps/api, whose `deploy` script uploads the Worker.
  const scripts = isRecord(manifests[0]?.scripts) ? manifests[0].scripts : {};
  const flags = deployFlags(typeof scripts.deploy === "string" ? scripts.deploy : "");
  const check = process.argv.includes("--check");
  // Before the build: with `"upload_source_maps": false` the dry run writes no map to read.
  const deploy = deployProblems(
    flags,
    uploadsSourceMaps(readFileSync(repoPath("apps/api/wrangler.jsonc"), "utf8")),
  );
  if (check && deploy.length > 0) fail(`worker-bundle: FAIL — ${deploy.join("; ")}.`);
  const { kib, locales, testOnly, packages } = measure(flags ?? []);
  console.log(
    `worker bundle: ${kib.toFixed(1)} KiB as deployed (${["wrangler deploy", ...(flags ?? [])].join(" ")}; budget ${BUDGET_KIB} KiB); zod locales: ${locales.join(", ") || "none"}; packages: ${packages.join(", ")}.`,
  );
  if (!check) return;
  const allowed = shippedDependencies(manifests);
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
