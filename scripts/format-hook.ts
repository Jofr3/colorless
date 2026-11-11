#!/usr/bin/env bun
/**
 * Claude Code's PostToolUse hook (`.claude/settings.json`): formats the file an Edit or Write just
 * touched with Biome. Claude Code passes the tool call as JSON on stdin, `tool_input.file_path`
 * naming the file.
 *
 * The file is formatted in the checkout that holds it (this one, or a worktree under it), with that
 * checkout's biome.json. The hook prints nothing and always exits 0: a file outside this repo, a
 * path Biome does not cover, or a file Biome cannot parse is left as the edit wrote it, and
 * `check` reports it as before. Format only; lint fixes can change code.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { localBin, REPO_ROOT } from "./lib/repo";

/** The edited file's absolute path, or null when the input names none. */
export function editedFile(stdin: string): string | null {
  try {
    const path = JSON.parse(stdin)?.tool_input?.file_path;
    return typeof path === "string" && isAbsolute(path) ? path : null;
  } catch {
    return null;
  }
}

/**
 * The checkout that holds `file`: its nearest ancestor with both `.git` and `biome.json`, no
 * higher than `repoRoot`. Null for a file outside `repoRoot`.
 */
export function checkoutOf(
  file: string,
  repoRoot: string,
  exists: (path: string) => boolean = existsSync,
): string | null {
  const path = resolve(file);
  if (!path.startsWith(repoRoot + sep)) return null;
  for (let dir = dirname(path); dir.startsWith(repoRoot); dir = dirname(dir)) {
    if (exists(join(dir, ".git")) && exists(join(dir, "biome.json"))) return dir;
  }
  return null;
}

export function formatEdited(stdin: string, repoRoot = REPO_ROOT): void {
  const file = editedFile(stdin);
  if (file === null) return;
  const checkout = checkoutOf(file, repoRoot);
  if (checkout === null) return;
  const own = join(checkout, "node_modules/.bin/biome");
  spawnSync(
    existsSync(own) ? own : localBin("biome"),
    ["format", "--write", "--no-errors-on-unmatched", "--files-ignore-unknown=true", file],
    { cwd: checkout, stdio: "ignore" },
  );
}

if (import.meta.main) {
  try {
    formatEdited(readFileSync(0, "utf8"));
  } catch {}
  process.exit(0);
}
