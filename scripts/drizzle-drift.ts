#!/usr/bin/env bun
/**
 * Fails when `apps/api/src/db/schema.ts` and the committed migrations disagree: an edited schema
 * whose `bun run db:generate` was never run, or a hand edit to a migration's snapshot. It runs
 * drizzle-kit generate against a scratch copy of `apps/api/drizzle` and fails if that would write
 * a new migration. drizzle-kit compares the schema with the snapshot JSON, not the SQL; the SQL is
 * covered by the route and migration tests that apply it.
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fail } from "./lib/cli";
import { repoPath } from "./lib/repo";

const API = repoPath("apps/api");
/** drizzle-kit resolves `--out` against its working directory, so the copy sits inside apps/api. */
const SCRATCH = join(".wrangler", "tmp", `drizzle-drift-${process.pid}`);

const listing = (dir: string) => readdirSync(dir, { recursive: true, encoding: "utf8" }).sort();

/** The failure message, or undefined when generate would write nothing. */
function drift(committed: readonly string[]): string | undefined {
  const out = join(SCRATCH, "drizzle");
  cpSync(join(API, "drizzle"), join(API, out), { recursive: true });
  const result = spawnSync(
    join(API, "node_modules", ".bin", "drizzle-kit"),
    ["generate", "--dialect", "sqlite", "--schema", "./src/db/schema.ts", "--out", out],
    // stdin closed and a timeout: a rename prompt must fail the check, not hang it.
    { cwd: API, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 },
  );
  if (result.status !== 0) {
    return `drizzle-drift: FAIL — drizzle-kit generate did not finish:\n${result.stdout}${result.stderr}`;
  }
  const added = listing(join(API, out)).filter((file) => !committed.includes(file));
  if (added.length === 0) return undefined;
  return [
    "drizzle-drift: FAIL — apps/api/src/db/schema.ts has changes no migration records:",
    ...added.map((file) => `  would write drizzle/${file}`),
    "Run `bun run db:generate` in apps/api and commit the migration (check it with",
    'docs/conventions.md "Database migrations" first).',
  ].join("\n");
}

const committed = listing(join(API, "drizzle"));
mkdirSync(join(API, SCRATCH), { recursive: true });
let problem: string | undefined;
try {
  problem = drift(committed);
} finally {
  rmSync(join(API, SCRATCH), { recursive: true, force: true });
}
if (problem !== undefined) fail(problem);
console.log(
  `drizzle-drift: OK — schema.ts matches ${committed.filter((f) => f.endsWith(".sql")).length} migrations.`,
);
