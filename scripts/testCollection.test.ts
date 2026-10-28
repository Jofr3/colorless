// Every test file in the repo is collected by a vitest project: the projects' includes name fixed
// roots and the `.ts` extension, so a test under a new root or with another extension would
// otherwise never run while every suite stays green.

import { spawnSync } from "node:child_process";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { isRecord, parseJson } from "./lib/cli";
import { localBin, REPO_ROOT, repoSourceFiles } from "./lib/repo";

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

function trackedTestFiles(): string[] {
  return repoSourceFiles(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]).filter((file) =>
    TEST_FILE.test(file),
  );
}

/** What vitest itself collects, asked the way a run would, outside this run's worker. */
function collectedTestFiles(): string[] {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST")),
  );
  const r = spawnSync(localBin("vitest"), ["list", "--filesOnly", "--json"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env,
  });
  if (r.status !== 0) throw new Error(`vitest list failed:\n${r.stdout}${r.stderr}`);
  const listed = parseJson(
    r.stdout,
    "vitest list",
    (v): v is { file: string }[] =>
      Array.isArray(v) && v.every((row) => isRecord(row) && typeof row.file === "string"),
  );
  return listed.map((row) => relative(REPO_ROOT, row.file));
}

function uncollected(tracked: readonly string[], collected: readonly string[]): string[] {
  const seen = new Set(collected);
  return tracked.filter((file) => !seen.has(file));
}

describe("test collection", () => {
  it("collects every test file in the repo", () => {
    const tracked = trackedTestFiles();
    const collected = collectedTestFiles();
    expect(tracked.length).toBeGreaterThan(0);
    expect(uncollected(tracked, collected)).toEqual([]);
    expect(uncollected([...tracked, "apps/next/src/widget.test.tsx"], collected)).toEqual([
      "apps/next/src/widget.test.tsx",
    ]);
  }, 60_000);
});
