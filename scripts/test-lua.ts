// Runs every headless Lua test under frontend/lua/tests under Lua 5.1, the
// dialect love.js ships: `lua5.1` when it is on PATH, else, where `nix` is,
// nixpkgs#lua5_1 (built once and kept under node_modules/.cache/lua5.1, a GC
// root, so a run pays no nix eval; resolved again if the link goes missing),
// else the system `lua`. LUA=<binary> overrides all of it (CI sets
// LUA=lua5.1); the summary names the interpreter. effects_gpu.lua needs
// love.js in a browser and is skipped. Tests that compare against Balatro's
// source exit 77 when it is missing
// (frontend/lua/tests/support/balatro_source.lua), or skip only those checks
// and say so (`PARTIAL`); --require-source makes either a failure instead.
// Files run concurrently, one per core; a failure's output is printed whole,
// in file order.
//
//   bun scripts/test-lua.ts [--require-source]

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { REPO_ROOT, repoPath } from "./lib/repo";

const TESTS = "frontend/lua/tests";
const BROWSER_ONLY = new Set(["effects_gpu.lua"]);
const SKIPPED = 77;
const TIMEOUT_MS = 60_000;
const SHIPPED = "lua5.1";
const NIX_LINK = repoPath("node_modules/.cache/lua5.1");
const lua = process.env.LUA ?? findShipped();
const requireSource = process.argv.includes("--require-source");

/** A Lua 5.1 binary: lua5.1 on PATH, else nixpkgs#lua5_1 through `nix`, else plain `lua`. */
function findShipped(): string {
  if (versionOf(SHIPPED) !== undefined) return SHIPPED;
  const linked = `${NIX_LINK}/bin/lua`;
  if (existsSync(linked)) return linked;
  if (spawnSync("nix", ["--version"]).status !== 0) return "lua";
  mkdirSync(repoPath("node_modules/.cache"), { recursive: true });
  const build = spawnSync("nix", ["build", "nixpkgs#lua5_1", "--out-link", NIX_LINK], {
    encoding: "utf8",
  });
  if (build.status === 0 && existsSync(linked)) return linked;
  console.log(`(nix build nixpkgs#lua5_1 failed, falling back to lua)\n${build.stderr.trim()}`);
  return "lua";
}

/** `Lua 5.1.5` and the like, or undefined when `bin` does not run. 5.1 prints it to stderr. */
function versionOf(bin: string): string | undefined {
  const run = spawnSync(bin, ["-v"], { encoding: "utf8" });
  if (run.error !== undefined || run.status !== 0) return undefined;
  return `${run.stdout}${run.stderr}`.match(/Lua(JIT)? [\d.]+/)?.[0];
}

/** What a test prints when it ran without its comparisons against the source. */
const PARTIAL = "source comparisons skipped";

type Outcome = { status: number | null; output: string; partial: boolean };

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
    child.on("close", (status) =>
      resolve({ status, output: stderr || stdout, partial: stdout.includes(PARTIAL) }),
    );
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
const partial: string[] = [];
for (const file of files) {
  const run = outcomes.get(file);
  if (run?.status === SKIPPED) skipped.push(file);
  else if (run?.status === 0 && run.partial) partial.push(file);
  else if (run?.status !== 0) {
    failed.push(file);
    console.error(`FAIL ${file}\n${run?.output ?? ""}`);
  }
}
const ran = files.length - skipped.length;
const version = versionOf(lua) ?? lua;
console.log(`${ran - failed.length}/${ran} Lua test files passed under ${version}`);
if (!version.startsWith("Lua 5.1"))
  console.log(`(love.js runs Lua 5.1; CI runs these under ${SHIPPED})`);
if (skipped.length > 0)
  console.log(`${skipped.length} skipped without Balatro source: ${skipped.join(", ")}`);
if (partial.length > 0)
  console.log(`${partial.length} ran without their source comparisons: ${partial.join(", ")}`);
if (failed.length > 0) process.exit(1);
