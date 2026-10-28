import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { repoPath } from "./lib/repo";

// Every run reads a private journal path without the override, so a mutation sweep's own journal
// (this suite is a killer in the corpus) never decides a case.
const dir = mkdtempSync(join(tmpdir(), "check-journal-"));
const journal = join(dir, "mutation-journal.json");
const { CHECK_DURING_MUTATION: _, ...env } = process.env;
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function check(steps: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const run = spawnSync("bun", [repoPath("scripts/check.ts"), ...steps], {
    encoding: "utf8",
    env: { ...env, MUTATION_JOURNAL_PATH: journal, ...extraEnv },
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

describe("check", () => {
  it("exits 0 when every step passes", () => {
    expect(check(["true", "true"]).status).toBe(0);
  });

  it("exits 1 and names the one step that failed", () => {
    const run = check(["true", "false"]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("1 step(s) FAILED: false");
  });

  it("counts a step that cannot start as failed", () => {
    const run = check(["true", "no-such-check-step"]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("FAILED: no-such-check-step");
  });
});

describe("check beside a mutation run", () => {
  const withJournal = (pid: number, extraEnv: NodeJS.ProcessEnv = {}) => {
    writeFileSync(journal, JSON.stringify({ startedAt: "", pid, files: [] }));
    try {
      return check(["true"], extraEnv);
    } finally {
      rmSync(journal);
    }
  };

  it("refuses while the run that wrote the journal is alive, and runs no step", () => {
    const run = withJournal(process.pid);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`a mutation sweep (pid ${process.pid}) is running`);
    expect(run.stdout).not.toContain("── true");
  });

  it("refuses when a dead run left its journal, and says how to restore", async () => {
    const gone = spawn("true");
    await new Promise((done) => gone.on("exit", done));
    const run = withJournal(gone.pid ?? 0);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Run `bun run mutants` once to restore them");
  });

  it("runs with the override set", () => {
    expect(withJournal(process.pid, { CHECK_DURING_MUTATION: "1" }).status).toBe(0);
  });
});
