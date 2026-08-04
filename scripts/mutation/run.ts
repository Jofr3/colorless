/**
 * THE MUTATION HARNESS (D211) — `bun run mutants`.
 *
 * WHY THIS EXISTS. Roughly thirty decision rows in `docs/decisions.md` publish a
 * mutant tally — D199's 36/36, D204's 16/1, D205's 18/1, D192's 13/3 — and every
 * one of them is UNREPRODUCIBLE BY CONSTRUCTION. Those tallies are also the only
 * evidence on record that this session's guards discriminate at all, which is
 * precisely the class this session proved rots: D200 → D204 → D205 each shipped
 * a flag that ran, passed, and was worthless. So the repo's central quality
 * claim was prose. This makes it a command.
 *
 * WHAT IT DOES. For each mutant in `mutants.ts`: run its target suites CLEAN to
 * establish a green baseline, apply the substitution to the real source file,
 * re-run the same suites, record RED (killed) or GREEN (survived), and put the
 * original bytes back. Then print a table.
 *
 * ─── RESTORATION — the part that has to be right ──────────────────────────────
 * This edits real source files in the working tree, and this session has already
 * lost a live agent's uncommitted work to a careless `git checkout`. So:
 *
 *   ⚠️ GIT IS NEVER USED TO RESTORE. Not `checkout`, not `stash`, not `restore`.
 *      The harness holds the original BYTES it read and writes exactly those
 *      back. A tree with a sibling agent's uncommitted edits in it comes out the
 *      way it went in, and a mutant applied to a dirty file restores the DIRTY
 *      version, not HEAD's.
 *
 *   Four layers, weakest failure first:
 *     1. `try/finally` around every mutation — the normal path.
 *     2. Signal handlers (SIGINT/SIGTERM/SIGHUP) and `uncaughtException` /
 *        `unhandledRejection`, which kill the child vitest and then restore.
 *     3. `process.on("exit")` with a SYNCHRONOUS write — the last-ditch net for
 *        any path that reaches exit with a file still mutated.
 *     4. A JOURNAL on disk (`tmp/mutation-journal.json`, gitignored), written
 *        BEFORE the mutated bytes ever touch the file and deleted only after the
 *        restore is verified. Layers 1–3 all live inside this process, so they
 *        all die together under `kill -9` or a lost container; the journal does
 *        not. On startup the harness looks for one, and if it finds it, it
 *        RESTORES FROM IT AND REFUSES TO RUN until that is done. That is the
 *        only case a crashed run can leave behind, and it self-heals.
 *
 * ─── WHAT THIS DOES NOT PROVE ────────────────────────────────────────────────
 *   • It does not measure coverage, and a green table is NOT "the suite is
 *     good". It says: these fourteen specific defects, on these specific lines,
 *     are caught by these specific suites, today.
 *   • It does not generate mutants. Every row is hand-transcribed from a landed
 *     decision, so it can only ever re-check claims someone already made — it
 *     cannot find the defect nobody thought to write down.
 *   • A KILLED verdict proves the suite goes red, not that it goes red FOR THE
 *     RIGHT REASON. The harness reads the exit code, not the failure message.
 *   • `expectKilledBy` is an author's judgement. Narrow it wrongly and a mutant
 *     can "survive" a suite that never loaded the mutated line. The `--full`
 *     flag exists to answer that question when it matters.
 *   • It says nothing about mutants NOT in the corpus, and nothing about the
 *     ~30 decision rows whose tallies were never transcribed here at all.
 *
 * ─── WHERE THIS SCRIPT SITS ──────────────────────────────────────────────────
 * Outside `tsc -b` and outside the vitest `include` globs, following the
 * precedent of `apps/api/scripts/ingest.ts` and `packages/schema/scripts/
 * validate-live.ts` — a dev tool has no business in the app's build graph or in
 * the suite it is meant to be an independent check on. Bun runs the TypeScript
 * directly. ⚠️ Note that the precedent is only HALF inherited: those two live
 * under `apps/**` / `packages/**`, which Biome's `files.include` covers, and
 * repo-root `scripts/**` is covered by NEITHER `biome.json` nor the `lint`
 * script's argument list — so this file is unlinted unless `scripts` is added to
 * both. See `docs/conventions.md`.
 *
 * ─── USAGE ───────────────────────────────────────────────────────────────────
 *   bun run mutants                 # every mutant
 *   bun run mutants --list          # print the corpus, run nothing
 *   bun run mutants --only D192-weakness,D196-seat-zone
 *   bun run mutants --decision D202 # every mutant transcribed from one row
 *   bun run mutants --full          # ignore expectKilledBy, run the whole suite
 *                                   # (~70s per mutant — the honest slow check)
 *   bun run mutants --verbose       # stream vitest output
 *
 * Exit code is 0 only when every mutant matched its declaration.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MUTANTS, type Mutant } from "./mutants.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JOURNAL = join(REPO_ROOT, "tmp", "mutation-journal.json");

// ─────────────────────────────────────────────────────────────────────────────
// Restoration
// ─────────────────────────────────────────────────────────────────────────────

/** Files currently mutated, keyed by absolute path, holding the ORIGINAL bytes.
    Base64 so the journal round-trips any encoding without a guess. */
const inFlight = new Map<string, Buffer>();

type Journal = { startedAt: string; pid: number; files: { path: string; originalB64: string }[] };

function writeJournal(): void {
  mkdirSync(dirname(JOURNAL), { recursive: true });
  const journal: Journal = {
    startedAt: new Date().toISOString(),
    pid: process.pid,
    files: [...inFlight].map(([path, buf]) => ({ path, originalB64: buf.toString("base64") })),
  };
  writeFileSync(JOURNAL, JSON.stringify(journal, null, 2));
}

function clearJournal(): void {
  if (existsSync(JOURNAL)) rmSync(JOURNAL);
}

/** Put every in-flight file back. SYNCHRONOUS on purpose — this is called from
    `process.on("exit")`, where nothing async can complete. Idempotent. */
function restoreAll(): void {
  for (const [path, original] of inFlight) {
    try {
      writeFileSync(path, original);
    } catch (err) {
      // Last-ditch: say it loudly with the path, so a human can recover by hand
      // from the journal even if this write failed.
      process.stderr.write(`\n!! FAILED TO RESTORE ${path}: ${String(err)}\n`);
      process.stderr.write(`!! original bytes are in ${JOURNAL}\n`);
      return;
    }
  }
  inFlight.clear();
  clearJournal();
}

/** Recover from a run that died where none of the in-process nets could fire
    (SIGKILL, OOM, container loss). Refuses to continue afterwards on purpose:
    the tree just changed under the user, and they should look at it. */
function recoverFromJournal(): boolean {
  if (!existsSync(JOURNAL)) return false;
  const journal = JSON.parse(readFileSync(JOURNAL, "utf8")) as Journal;
  console.error(`\n⚠️  A previous mutation run (pid ${journal.pid}, started ${journal.startedAt})`);
  console.error("    did not restore its files. Restoring them now from the journal.\n");
  for (const entry of journal.files) {
    writeFileSync(entry.path, Buffer.from(entry.originalB64, "base64"));
    console.error(`    restored ${entry.path}`);
  }
  clearJournal();
  console.error("\n    Done. Verify with `git diff --stat`, then re-run.\n");
  return true;
}

let child: ReturnType<typeof spawn> | null = null;

function installNets(): void {
  process.on("exit", restoreAll);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => {
      process.stderr.write(`\n[${sig}] restoring ${inFlight.size} file(s) before exit…\n`);
      child?.kill("SIGKILL");
      restoreAll();
      process.exit(130);
    });
  }
  process.on("uncaughtException", (err) => {
    process.stderr.write(`\n[uncaught] ${String(err)}\n`);
    child?.kill("SIGKILL");
    restoreAll();
    process.exit(1);
  });
  process.on("unhandledRejection", (err) => {
    process.stderr.write(`\n[unhandled rejection] ${String(err)}\n`);
    child?.kill("SIGKILL");
    restoreAll();
    process.exit(1);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Running vitest
// ─────────────────────────────────────────────────────────────────────────────

type SuiteResult = { green: boolean; ms: number; tail: string };

function runVitest(
  files: string[],
  nameFilter: string | undefined,
  verbose: boolean,
): Promise<SuiteResult> {
  const args = ["vitest", "run", "--reporter=dot", ...files];
  if (nameFilter !== undefined) args.push("-t", nameFilter);
  const started = Date.now();
  return new Promise((resolvePromise) => {
    const proc = spawn("bunx", args, {
      cwd: REPO_ROOT,
      stdio: verbose ? "inherit" : ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
    });
    child = proc;
    let out = "";
    proc.stdout?.on("data", (d: Buffer) => {
      out += d.toString();
    });
    proc.stderr?.on("data", (d: Buffer) => {
      out += d.toString();
    });
    proc.on("close", (code) => {
      child = null;
      resolvePromise({
        green: code === 0,
        ms: Date.now() - started,
        tail: out.split("\n").slice(-25).join("\n"),
      });
    });
  });
}

/** Baselines are shared across mutants that name the same suites — the corpus
    is deliberately clustered by decision, so this roughly halves wall time. */
const baselineCache = new Map<string, SuiteResult>();

async function baselineFor(files: string[], nameFilter: string | undefined, verbose: boolean) {
  const key = `${files.join("|")}::${nameFilter ?? ""}`;
  const hit = baselineCache.get(key);
  if (hit !== undefined) return hit;
  const result = await runVitest(files, nameFilter, verbose);
  baselineCache.set(key, result);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// One mutant
// ─────────────────────────────────────────────────────────────────────────────

type Verdict =
  | "KILLED" // no `survives`, suite went red — as declared
  | "SURVIVED" // ⚠️ no `survives`, suite stayed green — A GAP, or a false tally
  | "SURVIVES(known)" // `survives` declared, suite stayed green — as declared
  | "STALE-SURVIVOR" // ⚠️ `survives` declared, suite went red — the reason rotted
  | "ERROR"; // the row itself is broken: stale `find`, or a red baseline

type Row = {
  mutant: Mutant;
  verdict: Verdict;
  ms: number;
  note: string;
};

async function runMutant(mutant: Mutant, full: boolean, verbose: boolean): Promise<Row> {
  const absolute = resolve(REPO_ROOT, mutant.file);
  if (!absolute.startsWith(`${REPO_ROOT}/`)) {
    return { mutant, verdict: "ERROR", ms: 0, note: `path escapes the repo: ${mutant.file}` };
  }
  if (!existsSync(absolute)) {
    return { mutant, verdict: "ERROR", ms: 0, note: `file does not exist: ${mutant.file}` };
  }

  const original = readFileSync(absolute);
  const text = original.toString("utf8");

  // ⚠️ THE UNIQUENESS CHECK IS THE ROW'S EXPIRY DATE. Zero matches means the
  // code moved and the row is stale — that is an ERROR, never a skip, because a
  // silently-skipped mutant is exactly the vacuous guard this harness exists to
  // stop. Two or more means the substitution is not a fact about one site.
  const occurrences = text.split(mutant.find).length - 1;
  if (occurrences !== 1) {
    return {
      mutant,
      verdict: "ERROR",
      ms: 0,
      note:
        occurrences === 0
          ? `\`find\` no longer occurs in ${mutant.file} — the code moved; re-transcribe the row`
          : `\`find\` occurs ${occurrences}× in ${mutant.file} — ambiguous; make it unique`,
    };
  }

  const files = full ? [] : mutant.expectKilledBy;
  const nameFilter = full ? undefined : mutant.nameFilter;

  // A green baseline is a PRECONDITION, not a nicety. Without it, "the suite
  // went red" could just mean the suite was already red — which, with a sibling
  // agent editing `packages/engine/src` in the same tree, is a live hazard.
  const baseline = await baselineFor(files, nameFilter, verbose);
  if (!baseline.green) {
    return {
      mutant,
      verdict: "ERROR",
      ms: baseline.ms,
      note: `baseline is RED before mutating — no verdict is meaningful. Suites: ${files.join(" ") || "(full)"}`,
    };
  }

  const mutatedText = text.replace(mutant.find, mutant.replace);
  let mutated: SuiteResult;
  try {
    inFlight.set(absolute, original);
    writeJournal(); // journal BEFORE the file changes, never after
    writeFileSync(absolute, mutatedText);
    mutated = await runVitest(files, nameFilter, verbose);
  } finally {
    // ⚠️ THE ONE THING RESTORING BYTES CANNOT SURVIVE: somebody else writing the
    // same file during the ~2s window it is mutated. This repo runs concurrent
    // agents in one working tree, so that is not hypothetical. Restoring blindly
    // would silently eat their edit — the exact failure mode (uncommitted work
    // destroyed by a tool) this harness was written to avoid. So compare first,
    // and if the file is not the bytes we wrote, SAY SO and leave a copy of the
    // interloping version beside the journal rather than pretending.
    const onDisk = readFileSync(absolute);
    if (!onDisk.equals(Buffer.from(mutatedText))) {
      const rescue = `${JOURNAL}.clobbered-${Date.now()}`;
      writeFileSync(rescue, onDisk);
      process.stderr.write(
        `\n⚠️  ${mutant.file} was written by something else while mutated.\n` +
          `    Restoring the bytes this harness read; the intervening version is at\n    ${rescue}\n`,
      );
    }
    // The normal path. Layers 2–4 exist for every other path.
    writeFileSync(absolute, original);
    inFlight.delete(absolute);
    if (inFlight.size === 0) clearJournal();
    else writeJournal();
  }

  const killed = !mutated.green;
  const declaredSurvivor = mutant.survives !== undefined;
  const verdict: Verdict = declaredSurvivor
    ? killed
      ? "STALE-SURVIVOR"
      : "SURVIVES(known)"
    : killed
      ? "KILLED"
      : "SURVIVED";

  return {
    mutant,
    verdict,
    ms: mutated.ms,
    note: verdict === "SURVIVED" || verdict === "STALE-SURVIVOR" ? mutated.tail.trim() : "",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

/** Pad AND truncate — a long `decision` string must not shove the columns out
    of alignment, which is the only reason the table is readable at 16 rows. */
function cell(value: string, width: number): string {
  return (value.length > width - 1 ? `${value.slice(0, width - 2)}…` : value).padEnd(width);
}

function flagValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (recoverFromJournal()) process.exit(2);

  if (argv.includes("--list")) {
    for (const mutant of MUTANTS) {
      const tag =
        mutant.survives === undefined ? "" : `  [known survivor: ${mutant.survives.kind}]`;
      console.log(`${mutant.id.padEnd(22)} ${mutant.decision.padEnd(22)} ${mutant.what}${tag}`);
      console.log(`${" ".repeat(22)} ${mutant.file} → ${mutant.expectKilledBy.join(", ")}`);
    }
    return;
  }

  const only = flagValue(argv, "--only")?.split(",");
  const decision = flagValue(argv, "--decision");
  const full = argv.includes("--full");
  const verbose = argv.includes("--verbose");

  const selected = MUTANTS.filter(
    (m) =>
      (only === undefined || only.includes(m.id)) &&
      (decision === undefined || m.decision.includes(decision)),
  );
  if (selected.length === 0) {
    console.error("No mutants selected.");
    process.exit(2);
  }

  installNets();

  console.log(
    `\nMutation harness (D211) — ${selected.length} mutant(s)${full ? ", FULL suite" : ""}\n`,
  );
  const rows: Row[] = [];
  const started = Date.now();
  for (const mutant of selected) {
    process.stdout.write(`  ${mutant.id.padEnd(22)} … `);
    const row = await runMutant(mutant, full, verbose);
    rows.push(row);
    console.log(`${row.verdict.padEnd(16)} ${(row.ms / 1000).toFixed(1)}s`);
  }
  const totalMs = Date.now() - started;

  // ── the table ──
  console.log(`\n${"─".repeat(76)}`);
  console.log(
    `${cell("MUTANT", 22)}${cell("FROM", 24)}${cell("VERDICT", 17)}${cell("TIME", 8)}SUITES`,
  );
  console.log("─".repeat(76));
  for (const row of rows) {
    console.log(
      `${cell(row.mutant.id, 22)}${cell(row.mutant.decision, 24)}${cell(row.verdict, 17)}${cell(`${(row.ms / 1000).toFixed(1)}s`, 8)}${row.mutant.expectKilledBy.length}`,
    );
  }
  console.log("─".repeat(76));

  const killed = rows.filter((r) => r.verdict === "KILLED");
  const known = rows.filter((r) => r.verdict === "SURVIVES(known)");
  const gaps = rows.filter((r) => r.verdict === "SURVIVED");
  const stale = rows.filter((r) => r.verdict === "STALE-SURVIVOR");
  const errors = rows.filter((r) => r.verdict === "ERROR");

  console.log(
    `${killed.length} killed · ${known.length} known survivor(s) · ${gaps.length} GAP(S) · ${stale.length} stale · ${errors.length} error(s) · ${(totalMs / 1000).toFixed(1)}s total\n`,
  );

  for (const row of known) {
    console.log(`  known survivor  ${row.mutant.id} — ${row.mutant.survives?.kind}`);
    console.log(`      ${row.mutant.survives?.reason}\n`);
  }
  for (const row of gaps) {
    console.log(`\n⚠️  SURVIVED (undeclared) — ${row.mutant.id}  [${row.mutant.decision}]`);
    console.log(`    ${row.mutant.what}`);
    console.log(`    ${row.mutant.file}`);
    console.log(
      "    Either the suite has a real gap, or the decision row's tally was wrong. Both are findings — write one down.",
    );
  }
  for (const row of stale) {
    console.log(`\n⚠️  STALE-SURVIVOR — ${row.mutant.id}  [${row.mutant.decision}]`);
    console.log(`    Declared unkillable for: ${row.mutant.survives?.reason}`);
    console.log("    It was KILLED. That reason has stopped being true — update the row.");
  }
  for (const row of errors) {
    console.log(`\n⚠️  ERROR — ${row.mutant.id}: ${row.note}`);
  }

  process.exit(gaps.length + stale.length + errors.length === 0 ? 0 : 1);
}

await main();
