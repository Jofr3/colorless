// Runs every headless Lua test under frontend/lua/tests with the system `lua`
// (override with LUA=lua5.2). effects_gpu.lua needs love.js in a browser and is
// skipped.
//
//   bun scripts/test-lua.ts

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const TESTS = "frontend/lua/tests";
const BROWSER_ONLY = new Set(["effects_gpu.lua"]);
const lua = process.env.LUA ?? "lua";

const files = readdirSync(TESTS)
  .filter((f) => f.endsWith(".lua") && !BROWSER_ONLY.has(f))
  .sort();
const failed: string[] = [];
for (const file of files) {
  const run = spawnSync(lua, [`${TESTS}/${file}`], { encoding: "utf8", timeout: 60_000 });
  if (run.error !== undefined) throw run.error;
  if (run.status !== 0) {
    failed.push(file);
    console.error(`FAIL ${file}\n${run.stderr || run.stdout}`);
  }
}
console.log(`${files.length - failed.length}/${files.length} Lua test files passed`);
if (failed.length > 0) process.exit(1);
