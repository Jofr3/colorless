// Read-only wrangler calls shared by the database scripts (db-check, release-gate, ingest): JSON
// queries against the local or remote D1, and the Time Travel bookmark recorded before a remote write.

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const DATABASE = "colorless";
export const API_ROOT = fileURLToPath(new URL("..", import.meta.url));
/** Gitignored at the repo root; one line per recorded bookmark, newest last. */
export const BOOKMARK_LOG = join(API_ROOT, "..", "..", "tmp", "d1-bookmarks.log");

export type D1Target = "--local" | "--remote";
export type Row = Record<string, unknown>;

function wrangler(args: readonly string[]): string {
  const result = spawnSync("bunx", ["wrangler", ...args], {
    cwd: API_ROOT,
    encoding: "utf8",
    // A whole-catalog select prints several MB of JSON.
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`wrangler ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

/** The rows of each `;`-separated statement in `sql`, in order. */
export function d1Query(target: D1Target, sql: string): Row[][] {
  const out = wrangler(["d1", "execute", DATABASE, target, "--json", "--command", sql]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new Error(`wrangler d1 execute did not print JSON:\n${out}`);
  }
  if (!Array.isArray(parsed))
    throw new Error(`wrangler d1 execute printed no result list:\n${out}`);
  return parsed.map((statement: { results?: unknown }) => {
    if (!Array.isArray(statement.results)) throw new Error(`a statement had no results:\n${out}`);
    return statement.results as Row[];
  });
}

/**
 * Asks Time Travel for the remote database's current bookmark, prints it with the restore command,
 * and appends it to BOOKMARK_LOG. Restoring by `--timestamp` works without it inside the retention
 * window (7 days on the Free plan); the bookmark names the exact point before `reason`'s writes.
 */
export function recordBookmark(reason: string): string {
  const out = wrangler(["d1", "time-travel", "info", DATABASE, "--json"]);
  let bookmark: unknown;
  try {
    bookmark = (JSON.parse(out) as { bookmark?: unknown }).bookmark;
  } catch {
    bookmark = undefined;
  }
  if (typeof bookmark !== "string" || bookmark === "") {
    throw new Error(`wrangler d1 time-travel info printed no bookmark:\n${out}`);
  }
  const at = new Date().toISOString();
  mkdirSync(join(BOOKMARK_LOG, ".."), { recursive: true });
  appendFileSync(BOOKMARK_LOG, `${at} ${bookmark} ${reason}\n`);
  console.log(`D1 bookmark before ${reason}: ${bookmark} (logged to tmp/d1-bookmarks.log)`);
  console.log(
    `  restore: bunx wrangler d1 time-travel restore ${DATABASE} --bookmark=${bookmark} (from apps/api)`,
  );
  return bookmark;
}
