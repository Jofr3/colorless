#!/usr/bin/env bun
// The API Worker as `wrangler deploy` would upload it, built by a dry run (nothing is uploaded).
// Prints its minified size and the zod locales it carries. `--check` fails when the bundle
// passes `BUDGET_KIB` or carries a zod locale other than English: a single `import { z } from "zod"`
// keeps every locale, where `import * as z from "zod"` lets the bundler drop the unused ones. Byte
// counts only, never timings; a step of `check:static`.
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
  if (run.status !== 0) fail(`wrangler deploy --dry-run failed:\n${run.stdout}\n${run.stderr}`);
  const bytes = statSync(join(out, "index.js")).size;
  const map = parseJson(
    readFileSync(join(out, "index.js.map"), "utf8"),
    "index.js.map",
    (v): v is { sources: string[] } => isRecord(v) && Array.isArray(v.sources),
  );
  const locales = map.sources.flatMap((s) => {
    const name = LOCALE.exec(s)?.[1];
    return name === undefined || name === "index" ? [] : [name];
  });
  const kib = bytes / 1024;
  console.log(
    `worker bundle: ${kib.toFixed(1)} KiB minified (budget ${BUDGET_KIB} KiB); zod locales: ${locales.join(", ") || "none"}.`,
  );
  if (process.argv.includes("--check")) {
    const problems = [
      ...(kib > BUDGET_KIB ? [`the bundle is ${kib.toFixed(1)} KiB, over ${BUDGET_KIB} KiB`] : []),
      ...(locales.some((l) => l !== "en")
        ? [`it carries ${locales.length} zod locales; import zod as \`import * as z from "zod"\``]
        : []),
    ];
    if (problems.length > 0) fail(`worker-bundle: FAIL — ${problems.join("; ")}.`);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
