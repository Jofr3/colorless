#!/usr/bin/env bun
/**
 * Runs independent check steps concurrently, at most one per core, and exits 1 if any failed. Each
 * argument is one step, split on spaces and run without a shell from the repo root; a bare name
 * that `node_modules/.bin` provides runs from there. A step's output is printed whole when it
 * finishes, followed by a table of every step's time and result.
 *
 *   bun scripts/check.ts 'tsc -b' 'bun scripts/import-graph.ts --check'
 */

import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { fail } from "./lib/cli";
import { localBin, REPO_ROOT } from "./lib/repo";

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
