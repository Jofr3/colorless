#!/usr/bin/env bun
/**
 * The opt-in pre-push hook, run by `.githooks/pre-push`. Enable it once per clone with
 * `git config core.hooksPath .githooks`; skip it for one push with `git push --no-verify`.
 *
 * Each pushed commit's tree is exported to a temp directory, and `biome ci . --error-on-warnings`
 * and `scripts/decision-index.ts --check` run there. So the hook checks what is pushed, not the
 * working tree, which other agents may be editing. When `gitleaks` is on PATH and the pushed tree
 * has `.gitleaks.toml`, the commits the remote lacks are scanned for secrets.
 *
 * It refuses while a mutation journal exists, as `check.ts` does: the tree then holds mutated
 * source, and a commit made from it may carry a mutant.
 *
 * Git passes the remote's name and URL as arguments, and one line per pushed ref on stdin:
 *   <local ref> <local sha> <remote ref> <remote sha>
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localBin, REPO_ROOT, repoPath } from "./lib/repo";

/** One ref being pushed, as git describes it on the hook's stdin. */
export type Push = { localRef: string; localSha: string; remoteRef: string; remoteSha: string };

/** Git's all-zero object id: no local commit on a delete, no remote one on a new ref. */
const isZero = (sha: string) => /^0+$/.test(sha);

export function parsePushes(stdin: string): Push[] {
  return stdin
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const [localRef = "", localSha = "", remoteRef = "", remoteSha = ""] = line.split(/\s+/);
      return { localRef, localSha, remoteRef, remoteSha };
    });
}

/** Each pushed commit once. A deleted ref has nothing to check. */
export function pushedTips(pushes: readonly Push[]): string[] {
  return [...new Set(pushes.filter((p) => !isZero(p.localSha)).map((p) => p.localSha))];
}

/**
 * The `git log` options naming the commits `push` sends: those after the remote's tip, or, for a
 * new ref or a remote tip this clone has never fetched, those on no ref of `remote`.
 */
export function scanRange(push: Push, remote: string, hasCommit: (sha: string) => boolean) {
  if (isZero(push.localSha)) return undefined;
  if (!isZero(push.remoteSha) && hasCommit(push.remoteSha))
    return `${push.remoteSha}..${push.localSha}`;
  return `${push.localSha} --not --remotes=${remote}`;
}

/** Why the hook must not run, if a mutation journal says the tree may hold mutated source. */
export function journalRefusal(journal: string, exists: (path: string) => boolean) {
  if (!exists(journal)) return undefined;
  return [
    `pre-push: refusing: a mutation journal is at ${journal},`,
    "so a sweep is running or a dead one left files mutated, and a commit made now may carry a mutant.",
    "Wait for the sweep, or run `bun run mutants` once to restore a dead run's files.",
    "`git push --no-verify` pushes anyway.",
  ].join("\n");
}

/** The note printed instead of a secret scan, or undefined when the scan runs. */
export function secretScanSkip(gitleaksOnPath: boolean, hasConfig: boolean) {
  if (!gitleaksOnPath) return "gitleaks is not on PATH, so no secret scan";
  if (!hasConfig) return "the pushed tree has no .gitleaks.toml, so no secret scan";
  return undefined;
}

type Step = { name: string; ok: boolean; ms: number; output: string };

function run(name: string, bin: string, args: string[], cwd: string): Promise<Step> {
  const started = performance.now();
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d: Buffer) => {
      output += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      output += d.toString();
    });
    const finish = (ok: boolean, extra = "") =>
      resolve({ name, ok, ms: performance.now() - started, output: output + extra });
    child.on("error", (error) => finish(false, `\n${String(error)}\n`));
    child.on("close", (code) => finish(code === 0));
  });
}

function git(...args: string[]) {
  return spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
}

/** Extracts `sha`'s tree into a fresh directory outside the repo, sharing the repo's node_modules. */
function exportTree(sha: string, parent: string): string {
  const dir = mkdtempSync(join(parent, `${sha.slice(0, 12)}-`));
  const tar = join(parent, `${sha}.tar`);
  const archive = git("archive", "--format=tar", "-o", tar, sha);
  if (archive.status !== 0) throw new Error(`git archive ${sha} failed:\n${archive.stderr}`);
  const untar = spawnSync("tar", ["-xf", tar, "-C", dir], { encoding: "utf8" });
  if (untar.status !== 0) throw new Error(`extracting ${sha} failed:\n${untar.stderr}`);
  rmSync(tar);
  symlinkSync(repoPath("node_modules"), join(dir, "node_modules"));
  return dir;
}

/** Runs the checks for one push and returns the hook's exit code. */
async function main(): Promise<number> {
  const journal = process.env.MUTATION_JOURNAL_PATH ?? repoPath("tmp/mutation-journal.json");
  const refusal = journalRefusal(journal, existsSync);
  if (refusal !== undefined) {
    console.error(refusal);
    return 1;
  }

  const remote = process.argv[2] ?? "origin";
  const pushes = parsePushes(readFileSync(0, "utf8"));
  const tips = pushedTips(pushes);
  if (tips.length === 0) {
    console.log("pre-push: nothing to check.");
    return 0;
  }

  const started = performance.now();
  const parent = mkdtempSync(join(tmpdir(), "colorless-pre-push-"));
  try {
    const trees = new Map(tips.map((sha) => [sha, exportTree(sha, parent)]));
    const gitleaksOnPath = spawnSync("gitleaks", ["version"]).error === undefined;
    const notes: string[] = [];
    const steps: Promise<Step>[] = [];
    const biome = [
      "ci",
      ".",
      "--error-on-warnings",
      ...(process.stdout.isTTY ? [] : ["--colors=off"]),
    ];
    for (const [sha, dir] of trees) {
      const at = tips.length > 1 ? ` @ ${sha.slice(0, 12)}` : "";
      steps.push(run(`biome ci${at}`, localBin("biome"), biome, dir));
      steps.push(
        run(`decision-index --check${at}`, "bun", ["scripts/decision-index.ts", "--check"], dir),
      );
    }
    const hasCommit = (sha: string) => git("cat-file", "-e", `${sha}^{commit}`).status === 0;
    for (const push of pushes) {
      const range = scanRange(push, remote, hasCommit);
      const dir = trees.get(push.localSha);
      if (range === undefined || dir === undefined) continue;
      const config = join(dir, ".gitleaks.toml");
      const skip = secretScanSkip(gitleaksOnPath, existsSync(config));
      if (skip !== undefined) {
        notes.push(`${push.localRef}: ${skip}`);
        continue;
      }
      const args = ["git", "--no-banner", "--redact", "--verbose", "--log-level=warn"];
      args.push("--config", config, `--log-opts=${range}`, REPO_ROOT);
      steps.push(run(`gitleaks ${push.localRef}`, "gitleaks", args, REPO_ROOT));
    }

    const results = await Promise.all(steps);
    for (const step of results) {
      const status = step.ok ? "ok" : "FAILED";
      console.log(`pre-push: ${step.name} · ${status} · ${(step.ms / 1000).toFixed(1)}s`);
      if (!step.ok) console.log(step.output.trimEnd());
    }
    for (const note of notes) console.log(`pre-push: ${note}.`);
    const failed = results.filter((s) => !s.ok).map((s) => s.name);
    const total = `${((performance.now() - started) / 1000).toFixed(1)}s`;
    if (failed.length > 0) {
      console.error(`pre-push: FAILED (${failed.join(", ")}) in ${total}.`);
      console.error("Fix it and push again, or `git push --no-verify` to push anyway.");
      return 1;
    }
    console.log(`pre-push: OK in ${total}.`);
    return 0;
  } catch (error) {
    console.error(`pre-push: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exit(await main());
