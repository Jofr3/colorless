// Repo-root paths and file listing, so scripts work from any working directory.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Absolute path of a repo-relative path. */
export function repoPath(relative: string): string {
  return resolve(REPO_ROOT, relative);
}

/**
 * The main checkout's root (the parent of git's common dir), the same from every worktree;
 * `undefined` outside git. frontend/lua/balatroSource.mjs has the same lookup for the Lua build.
 */
export function mainCheckout(cwd = REPO_ROOT): string | undefined {
  const git = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd,
    encoding: "utf8",
  });
  return git.status === 0 ? dirname(git.stdout.trim()) : undefined;
}

/** The repo's own copy of a dev tool, falling back to whatever `PATH` finds. */
export function localBin(name: string): string {
  const local = repoPath(`node_modules/.bin/${name}`);
  return existsSync(local) ? local : name;
}

/** A memoised reader of repo-relative files, for scripts that read one file per corpus row. */
export function sourceCache(): (file: string) => string {
  const sources = new Map<string, string>();
  return (file) => {
    const cached = sources.get(file);
    if (cached !== undefined) return cached;
    const text = readFileSync(repoPath(file), "utf8");
    sources.set(file, text);
    return text;
  };
}

/**
 * Repo-relative paths of every file with one of `extensions`: tracked files plus untracked ones
 * `.gitignore` does not cover, minus anything deleted from the working tree but still in the index.
 */
export function repoSourceFiles(extensions: readonly string[]): string[] {
  const patterns = extensions.map((e) => `*.${e}`);
  const git = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...patterns],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  if (git.status !== 0) throw new Error(`git ls-files failed:\n${git.stderr}`);
  const seen = new Set(git.stdout.split("\0").filter(Boolean));
  return [...seen]
    .filter((f) => {
      const path = repoPath(f);
      return existsSync(path) && statSync(path).isFile();
    })
    .sort();
}
