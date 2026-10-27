import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { repoPath } from "./lib/repo";

function check(...steps: string[]) {
  const run = spawnSync("bun", [repoPath("scripts/check.ts"), ...steps], { encoding: "utf8" });
  return { status: run.status, stderr: run.stderr };
}

describe("check", () => {
  it("exits 0 when every step passes", () => {
    expect(check("true", "true").status).toBe(0);
  });

  it("exits 1 and names the one step that failed", () => {
    const run = check("true", "false");
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("1 step(s) FAILED: false");
  });

  it("counts a step that cannot start as failed", () => {
    const run = check("true", "no-such-check-step");
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("FAILED: no-such-check-step");
  });
});
