// Runs every headless Lua test under frontend/lua/tests with the system `lua`
// (override with LUA=lua5.2). effects_gpu.lua needs love.js in a browser and is
// skipped. Tests that compare against Balatro's source exit 77 when it is
// missing (frontend/lua/tests/support/balatro_source.lua); --require-source
// makes that a failure instead. Files run concurrently, one per core; a
// failure's output is printed whole, in file order.
//
//   bun scripts/test-lua.ts [--require-source]

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { REPO_ROOT, repoPath } from "./lib/repo";

const TESTS = "frontend/lua/tests";
const BROWSER_ONLY = new Set(["effects_gpu.lua"]);
const SKIPPED = 77;
const TIMEOUT_MS = 60_000;
const lua = process.env.LUA ?? "lua";
const requireSource = process.argv.includes("--require-source");

type Outcome = { status: number | null; output: string };

function runOne(file: string): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(lua, [`${TESTS}/${file}`], {
      cwd: REPO_ROOT,
      env: requireSource ? { ...process.env, COLORLESS_REQUIRE_SOURCE: "1" } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: TIMEOUT_MS,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, output: stderr || stdout }));
  });
}

const files = readdirSync(repoPath(TESTS))
  .filter((f) => f.endsWith(".lua") && !BROWSER_ONLY.has(f))
  .sort();
const outcomes = new Map<string, Outcome>();
const queue = [...files];
await Promise.all(
  Array.from({ length: Math.min(availableParallelism(), files.length) }, async () => {
    for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
      outcomes.set(file, await runOne(file));
    }
  }),
);

const failed: string[] = [];
const skipped: string[] = [];
for (const file of files) {
  const run = outcomes.get(file);
  if (run?.status === SKIPPED) skipped.push(file);
  else if (run?.status !== 0) {
    failed.push(file);
    console.error(`FAIL ${file}\n${run?.output ?? ""}`);
  }
}
const ran = files.length - skipped.length;
console.log(`${ran - failed.length}/${ran} Lua test files passed`);
if (skipped.length > 0)
  console.log(`${skipped.length} skipped without Balatro source: ${skipped.join(", ")}`);
if (failed.length > 0) process.exit(1);
