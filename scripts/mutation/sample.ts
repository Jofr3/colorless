/**
 * CI's mutant sample: every row whose `file` or killer the diff touches (capped), plus a seeded
 * random draw from the rest, run through `run.ts --only`. Precheck proves anchors are unique; this
 * proves a slice of killers still kill.
 *
 *   bun scripts/mutation/sample.ts                    # random draw only
 *   bun scripts/mutation/sample.ts --base origin/main # plus rows the diff from that ref touches
 *   bun scripts/mutation/sample.ts --random 30 --cap 60 --seed abc --list
 *
 * The seed defaults to GITHUB_SHA, then HEAD, so a re-run of one commit picks the same rows. An
 * unknown base (a first push, a force-push) is reported and the run continues with the draw. A
 * known base whose diff still fails stops the run: without it the job would stay green while
 * running no targeted row.
 */

import { spawnSync } from "node:child_process";
import { fail } from "../lib/cli.ts";
import { REPO_ROOT } from "../lib/repo.ts";
import { MUTANTS, type Mutant } from "./mutants.ts";

type Options = { random: number; cap: number; seed: string };

function rng(seed: string): () => number {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function draw<T>(items: readonly T[], n: number, next: () => number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    [pool[i], pool[j]] = [pool[j] as T, pool[i] as T];
  }
  return pool.slice(0, n);
}

export function touches(mutant: Mutant, changed: ReadonlySet<string>): boolean {
  return changed.has(mutant.file) || mutant.expectKilledBy.some((f) => changed.has(f));
}

/** The rows to run, and how many diff-touched rows the cap left out. */
export function pickSample(
  mutants: readonly Mutant[],
  changed: ReadonlySet<string>,
  options: Options,
): { touched: Mutant[]; random: Mutant[]; dropped: number } {
  const next = rng(options.seed);
  const hit = mutants.filter((m) => touches(m, changed));
  const touched = draw(hit, options.cap, next);
  const rest = mutants.filter((m) => !touches(m, changed));
  return {
    touched,
    random: draw(rest, options.random, next),
    dropped: hit.length - touched.length,
  };
}

function git(...args: string[]): string | undefined {
  const r = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

type Git = (...args: string[]) => string | undefined;

/** The files changed since `base`, or why there are none. `--no-renames` lists both sides of a
    rename and reads no file contents: rename detection would fetch blobs, which CI's blob:none
    checkout lacks and, with no credentials kept, cannot fetch. */
export function changedSince(
  base: string,
  run: Git = git,
): { files: Set<string> } | { unknownBase: true } | { error: string } {
  if (run("cat-file", "-e", `${base}^{commit}`) === undefined) return { unknownBase: true };
  const diff = run("diff", "--no-renames", "--name-only", `${base}...HEAD`);
  if (diff === undefined) return { error: `git diff ${base}...HEAD failed` };
  return { files: new Set(diff.split("\n").filter(Boolean)) };
}

function parseArgs(argv: readonly string[]) {
  const values = new Map<string, string>();
  let list = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--list") list = true;
    else if (["--base", "--random", "--cap", "--seed"].includes(arg)) {
      const value = argv[i + 1];
      if (value === undefined || values.has(arg)) fail(`${arg} needs exactly one value`);
      values.set(arg, value);
      i += 1;
    } else fail(`unknown argument \`${arg}\``);
  }
  const count = (flag: string, fallback: number) => {
    const raw = values.get(flag);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) fail(`${flag} must be a non-negative integer`);
    return n;
  };
  const seed = values.get("--seed") ?? process.env.GITHUB_SHA ?? git("rev-parse", "HEAD") ?? "";
  return {
    base: values.get("--base"),
    list,
    options: { random: count("--random", 30), cap: count("--cap", 60), seed },
  };
}

if (import.meta.main) {
  const { base, list, options } = parseArgs(process.argv.slice(2));
  let changed = new Set<string>();
  if (base !== undefined) {
    const since = changedSince(base);
    if ("error" in since)
      fail(`sample: ${since.error}; the rows on changed files cannot be picked`);
    if ("unknownBase" in since) console.log(`sample: base \`${base}\` not found; random draw only`);
    else changed = since.files;
  }
  const { touched, random, dropped } = pickSample(MUTANTS, changed, options);
  console.log(
    `sample: ${touched.length} row(s) on changed files${dropped > 0 ? ` (${dropped} more left out by --cap ${options.cap})` : ""}, ${random.length} random, seed ${options.seed.slice(0, 12)}`,
  );
  const ids = [...touched, ...random].map((m) => m.id);
  if (list || ids.length === 0) {
    for (const id of ids) console.log(`  ${id}`);
    process.exit(0);
  }
  const run = spawnSync("bun", ["scripts/mutation/run.ts", "--only", ids.join(",")], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  process.exit(run.status ?? 1);
}
