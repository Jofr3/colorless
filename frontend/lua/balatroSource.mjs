// @ts-check
// Where Balatro's source tree is, for the Lua build, its tools and the Lua tests. The tree is not in
// this repository; it sits beside the main checkout, which a git worktree under .claude/worktrees
// does not have beside it, so the default is found through git's common dir.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** The main checkout's root (the parent of git's common dir), the same from every worktree;
    undefined outside git. @param {string} cwd */
export function mainCheckout(cwd) {
  const git = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd,
    encoding: "utf8",
  });
  return git.status === 0 ? dirname(git.stdout.trim()) : undefined;
}

/** `$BALATRO_SOURCE`, else ../balatro-source beside the main checkout, else beside `root`.
    @param {string} root @param {Record<string, string | undefined>} env
    @returns {{ dir: string, from: string }} */
export function balatroSource(root, env = process.env) {
  if (env.BALATRO_SOURCE) return { dir: resolve(env.BALATRO_SOURCE), from: "BALATRO_SOURCE" };
  const main = mainCheckout(root);
  if (main !== undefined)
    return { dir: resolve(main, "../balatro-source"), from: "beside the main checkout" };
  return { dir: resolve(root, "../balatro-source"), from: "beside this checkout" };
}

/** Why `source` cannot serve, in one line, or undefined when it can. The Lua tests read the game's
    Lua; the build also needs love.js installed in the tree.
    @param {{ dir: string, from: string }} source @param {{ loveJs: boolean }} needs */
export function sourceProblem({ dir, from }, { loveJs }) {
  if (!existsSync(join(dir, "engine/ui.lua")))
    return `No Balatro source at ${dir} (${from}). Set BALATRO_SOURCE to the tree, or check it out as balatro-source beside the main checkout.`;
  if (loveJs && !existsSync(join(dir, "node_modules/love.js/index.js")))
    return `Balatro source at ${dir} has no love.js: run \`npm install love.js@11.4.1\` in it.`;
  return undefined;
}
