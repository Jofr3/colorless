#!/usr/bin/env bun
/**
 * Runs independent check steps concurrently, at most one per core, and exits 1 if any failed. Each
 * argument is one step, split on spaces and run without a shell from the repo root; a bare name
 * that `node_modules/.bin` provides runs from there. A step's output is printed whole when it
 * finishes, followed by a table of every step's time and result.
 *
 * It refuses to start while a mutation sweep's journal exists (`mutationJournalProblem`).
 *
 *   bun scripts/check.ts 'tsc -b' 'bun scripts/import-graph.ts --check'
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fail } from "./lib/cli";
import { localBin, REPO_ROOT, repoPath } from "./lib/repo";

/** Set to `1` to check anyway. */
const OVERRIDE = "CHECK_DURING_MUTATION";

/**
 * Why a check now would read mutated source, if it would. `scripts/mutation/run.ts` keeps its
 * journal on disk exactly while a mutant is written: a live writer is mid-sweep, and a dead one
 * left its files unrestored. Either way the steps would go red for nothing (D411).
 */
function mutationJournalProblem(): string | undefined {
  if (process.env[OVERRIDE] === "1") return undefined;
  const journal = process.env.MUTATION_JOURNAL_PATH ?? repoPath("tmp/mutation-journal.json");
  if (!existsSync(journal)) return undefined;
  let pid: unknown;
  try {
    pid = (JSON.parse(readFileSync(journal, "utf8")) as { pid?: unknown }).pid;
  } catch {
    pid = undefined;
  }
  const [what, next] =
    typeof pid !== "number"
      ? ["an unreadable mutation journal", "Read it and restore its files by hand"]
      : pidIsAlive(pid)
        ? [`a mutation sweep (pid ${pid}) is running; its journal`, "Wait for it to finish"]
        : [
            `a dead mutation run (pid ${pid}) left its files mutated; its journal`,
            "Run `bun run mutants` once to restore them",
          ];
  return [
    `check: refusing to start: ${what} is at ${journal},`,
    "so the steps would read mutated source.",
    `${next}, or set ${OVERRIDE}=1 to check anyway.`,
  ].join("\n");
}

/** `run.ts`'s liveness test: signal 0 sends nothing, and EPERM is alive under another user. */
function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

type Result = { step: string; ok: boolean; ms: number; output: string };

function run(step: string): Promise<Result> {
  const [bin = "", ...args] = step.split(" ").filter(Boolean);
  const started = performance.now();
  return new Promise((resolve) => {
    const child = spawn(localBin(bin), args, {
      cwd: REPO_ROOT,
      env: process.stdout.isTTY ? { ...process.env, FORCE_COLOR: "1" } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d: Buffer) => {
      output += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      output += d.toString();
    });
    const finish = (ok: boolean, extra = "") =>
      resolve({ step, ok, ms: performance.now() - started, output: output + extra });
    child.on("error", (error) => finish(false, `\n${String(error)}\n`));
    child.on("close", (code) => finish(code === 0));
  });
}

const steps = process.argv.slice(2);
if (steps.length === 0) fail("check: name at least one step to run.");
const sweep = mutationJournalProblem();
if (sweep !== undefined) fail(sweep);

const results: Result[] = [];
const queue = [...steps];
await Promise.all(
  Array.from({ length: Math.min(availableParallelism(), steps.length) }, async () => {
    for (let step = queue.shift(); step !== undefined; step = queue.shift()) {
      const result = await run(step);
      results.push(result);
      const status = result.ok ? "ok" : "FAILED";
      console.log(`\n── ${step} · ${status} · ${(result.ms / 1000).toFixed(1)}s`);
      if (result.output.trim() !== "") console.log(result.output.trimEnd());
    }
  }),
);

const width = Math.max(...steps.map((s) => s.length));
console.log("");
for (const step of steps) {
  const result = results.find((r) => r.step === step);
  if (result === undefined) continue;
  console.log(
    `${step.padEnd(width)}  ${(result.ms / 1000).toFixed(1).padStart(6)}s  ${result.ok ? "ok" : "FAILED"}`,
  );
}
const failed = results.filter((r) => !r.ok).map((r) => r.step);
if (failed.length > 0) {
  console.error(`\ncheck: ${String(failed.length)} step(s) FAILED: ${failed.join(", ")}`);
  process.exit(1);
}
