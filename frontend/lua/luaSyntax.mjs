// @ts-check
// The Lua build's syntax check: love.js reports a syntax error only in the browser, after the build
// has said it succeeded.
import { spawnSync } from "node:child_process";
import { join } from "node:path";

/** Where a Lua 5.1 luac may be: luac5.1 on PATH, the nixpkgs build test-lua.ts links into this
    checkout or the main one, then plain luac.
    @param {string} root @param {string | undefined} main */
export function luacCandidates(root, main) {
  const linked = [...new Set([root, main ?? root])].map((dir) =>
    join(dir, "node_modules/.cache/lua5.1/bin/luac"),
  );
  return ["luac5.1", ...linked, "luac"];
}

/** The first candidate that runs as Lua 5.1, the dialect love.js ships: 5.2 also accepts `goto`.
    @param {string[]} candidates */
export function findLuac(candidates) {
  return candidates.find((bin) => {
    const run = spawnSync(bin, ["-v"], { encoding: "utf8" });
    return run.status === 0 && /^Lua 5\.1\./.test(`${run.stdout}${run.stderr}`);
  });
}

/** luac's first syntax error over `files` (relative to `cwd`, so it reads `ui/x.lua:N`), or
    undefined when every file parses.
    @param {string} luac @param {string} cwd @param {string[]} files */
export function luaSyntaxError(luac, cwd, files) {
  const run = spawnSync(luac, ["-p", ...files], { cwd, encoding: "utf8" });
  if (run.status === 0) return undefined;
  const message = `${run.stderr ?? ""}${run.stdout ?? ""}`.trim() || String(run.error);
  return message.startsWith(`${luac}: `) ? message.slice(luac.length + 2) : message;
}
