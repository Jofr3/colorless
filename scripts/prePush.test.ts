import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoPath } from "./lib/repo";
import {
  journalRefusal,
  type Push,
  parsePushes,
  pushedTips,
  scanRange,
  secretScanSkip,
} from "./pre-push";

const ZERO = "0".repeat(40);
const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

const push = (localSha: string, remoteSha: string, ref = "refs/heads/main"): Push => ({
  localRef: ref,
  localSha,
  remoteRef: ref,
  remoteSha,
});

describe("parsePushes", () => {
  it("reads one ref per line and skips blank lines", () => {
    expect(
      parsePushes(
        `refs/heads/main ${A} refs/heads/main ${B}\n\nrefs/tags/v1 ${C} refs/tags/v1 ${ZERO}\n`,
      ),
    ).toEqual([push(A, B), push(C, ZERO, "refs/tags/v1")]);
  });
});

describe("pushedTips", () => {
  it("checks each pushed commit once and skips deleted refs", () => {
    expect(pushedTips([push(A, B), push(A, ZERO, "refs/heads/x"), push(ZERO, C)])).toEqual([A]);
  });
});

describe("scanRange", () => {
  const known = (sha: string) => sha === B;

  it("scans from the remote's tip when this clone has it", () => {
    expect(scanRange(push(A, B), "origin", known)).toBe(`${B}..${A}`);
  });

  it("scans what no remote ref has for a new ref", () => {
    expect(scanRange(push(A, ZERO), "origin", known)).toBe(`${A} --not --remotes=origin`);
  });

  it("scans what no remote ref has when the remote's tip was never fetched", () => {
    expect(scanRange(push(A, C), "origin", known)).toBe(`${A} --not --remotes=origin`);
  });

  it("scans nothing for a deleted ref", () => {
    expect(scanRange(push(ZERO, B), "origin", known)).toBeUndefined();
  });
});

describe("journalRefusal", () => {
  it("refuses while the journal exists, naming it", () => {
    expect(journalRefusal("/j.json", () => true)).toContain("mutation journal is at /j.json");
  });

  it("lets the push through without one", () => {
    expect(journalRefusal("/j.json", () => false)).toBeUndefined();
  });

  it("refuses from the command, even when the push has nothing to check", () => {
    const dir = mkdtempSync(join(tmpdir(), "pre-push-test-"));
    try {
      const journal = join(dir, "journal.json");
      writeFileSync(journal, JSON.stringify({ pid: 1 }));
      const run = spawnSync("bun", [repoPath("scripts/pre-push.ts"), "origin"], {
        input: `(delete) ${ZERO} refs/heads/old ${B}\n`,
        env: { ...process.env, MUTATION_JOURNAL_PATH: journal },
        encoding: "utf8",
      });
      expect(run.status).toBe(1);
      expect(run.stderr).toContain(`mutation journal is at ${journal}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("secretScanSkip", () => {
  it("scans when gitleaks is installed and the tree has its config", () => {
    expect(secretScanSkip(true, true)).toBeUndefined();
  });

  it("names the missing binary first, then the missing config", () => {
    expect(secretScanSkip(false, true)).toContain("not on PATH");
    expect(secretScanSkip(false, false)).toContain("not on PATH");
    expect(secretScanSkip(true, false)).toContain("no .gitleaks.toml");
  });
});
