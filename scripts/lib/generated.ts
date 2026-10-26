// Shared plumbing for scripts that write a committed, generated source file.

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { localBin, REPO_ROOT, repoPath } from "./repo";

/**
 * `source` as `biome format` would write it to `out`, so the committed file passes the format
 * check and `--check` compares like with like. Formats a temp file in place (biome's stdin mode
 * mangles emoji).
 */
export function biomeFormatted(out: string, source: string): string {
  const temp = repoPath(`${out}.tmp.ts`);
  writeFileSync(temp, source);
  try {
    const run = spawnSync(localBin("biome"), ["format", "--write", temp], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    if (run.status !== 0) throw new Error(`biome format failed: ${run.stderr}`);
    return readFileSync(temp, "utf8");
  } finally {
    rmSync(temp, { force: true });
  }
}

/** The committed file at repo-relative `out`, or "" when there is none yet. */
export function committedText(out: string): string {
  try {
    return readFileSync(repoPath(out), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

/** Drops the provenance stamps (local file name, mtime, size, run date), which differ per machine. */
export function withoutStamps(text: string): string {
  return text.replace(/(path|mtime|generated): "[^"]*"|bytes: \d+/g, "");
}
