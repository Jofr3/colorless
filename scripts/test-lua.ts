// Runs every headless Lua test under frontend/lua/tests with the system `lua`
// (override with LUA=lua5.2). effects_gpu.lua needs love.js in a browser and is
// skipped. Tests that compare against Balatro's source exit 77 when it is
// missing (frontend/lua/tests/support/balatro_source.lua); --require-source
// makes that a failure instead.
//
//   bun scripts/test-lua.ts [--require-source]

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { REPO_ROOT, repoPath } from "./lib/repo";

const TESTS = "frontend/lua/tests";
const BROWSER_ONLY = new Set(["effects_gpu.lua"]);
const SKIPPED = 77;
const lua = process.env.LUA ?? "lua";
const requireSource = process.argv.includes("--require-source");

const files = readdirSync(repoPath(TESTS))
  .filter((f) => f.endsWith(".lua") && !BROWSER_ONLY.has(f))
  .sort();
const failed: string[] = [];
const skipped: string[] = [];
for (const file of files) {
  const run = spawnSync(lua, [`${TESTS}/${file}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 60_000,
    env: requireSource ? { ...process.env, COLORLESS_REQUIRE_SOURCE: "1" } : process.env,
  });
  if (run.error !== undefined) throw run.error;
  if (run.status === SKIPPED) skipped.push(file);
  else if (run.status !== 0) {
    failed.push(file);
    console.error(`FAIL ${file}\n${run.stderr || run.stdout}`);
  }
}
const ran = files.length - skipped.length;
console.log(`${ran - failed.length}/${ran} Lua test files passed`);
if (skipped.length > 0)
  console.log(`${skipped.length} skipped without Balatro source: ${skipped.join(", ")}`);
if (failed.length > 0) process.exit(1);
