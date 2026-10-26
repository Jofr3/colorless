/**
 * Mutation harness (`bun run mutants`). For each mutant: run its suites clean, apply the
 * substitution, re-run, record killed or survived, and write the original bytes back. Restoration
 * never uses git; its layers are try/finally, signal handlers, a synchronous exit write, and an
 * on-disk journal that startup recovers only if its writer pid is dead. Files with uncommitted
 * changes are skipped (SKIPPED-DIRTY) unless `--allow-dirty`. A kill proves the suite went red, not
 * why.
 *
 *   bun run mutants                 # every mutant
 *   bun run mutants --list          # print the corpus, run nothing
 *   bun run mutants --only ID,ID
 *   bun run mutants --decision ID   # every mutant from one decision
 *   bun run mutants --full          # ignore expectKilledBy, run the whole suite
 *   bun run mutants --verbose       # stream vitest output
 *   bun run mutants --allow-dirty   # mutate files with your own uncommitted changes
 *
 * Any other argument is rejected. Exit codes are in `EXIT`.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { isRecord, parseJson } from "../lib/cli.ts";
import { REPO_ROOT } from "../lib/repo.ts";
import { applyMutant } from "./apply.ts";
import { argvProblems, knownFlagsUsage } from "./argv.ts";
import { MUTANTS, type Mutant } from "./mutants.ts";

/**
 * Process exit codes. `noSelection` shares 2 with `recovered`; recovery-gate tells them apart by
 * the restored bytes.
 */
const EXIT = {
  /** Every mutant matched its declaration. */
  ok: 0,
  /** A gap, stale survivor, error, skip or clobber. */
  findings: 1,
  /** A dead run's journal was recovered; nothing else ran. */
  recovered: 2,
  noSelection: 2,
  /** Another run is in flight; nothing was touched. */
  inFlight: 3,
  /** The command line was rejected; nothing ran. */
  badArgv: 4,
  /** Interrupted by a signal, after restoring every file. */
  interrupted: 130,
} as const;

/**
 * Overridable so `recovery-gate.ts` can use a private journal path while a real harness run holds
 * its own.
 */
const JOURNAL =
  process.env.MUTATION_JOURNAL_PATH ?? join(REPO_ROOT, "tmp", "mutation-journal.json");

/**
 * Vitest's on-disk module cache for this harness, kept apart from the default one. A mutant run
 * caches its mutated module like any other, so the entries a mutant run adds are deleted after it.
 */
const MODULE_CACHE = join(REPO_ROOT, "tmp", "mutation-vitest-cache");

function moduleCacheEntries(): Set<string> {
  return new Set(existsSync(MODULE_CACHE) ? readdirSync(MODULE_CACHE) : []);
}

function dropModuleCacheEntriesBesides(kept: ReadonlySet<string>): void {
  for (const name of moduleCacheEntries()) {
    if (!kept.has(name)) rmSync(join(MODULE_CACHE, name), { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Restoration
// ─────────────────────────────────────────────────────────────────────────────

/** Files currently mutated, keyed by absolute path, holding the ORIGINAL bytes.
    Base64 so the journal round-trips any encoding without a guess. */
const inFlight = new Map<string, Buffer>();

type Journal = { startedAt: string; pid: number; files: { path: string; originalB64: string }[] };

function isJournal(v: unknown): v is Journal {
  return (
    isRecord(v) &&
    typeof v.startedAt === "string" &&
    typeof v.pid === "number" &&
    Array.isArray(v.files) &&
    v.files.every(
      (f) => isRecord(f) && typeof f.path === "string" && typeof f.originalB64 === "string",
    )
  );
}

function writeJournal(): void {
  mkdirSync(dirname(JOURNAL), { recursive: true });
  const journal: Journal = {
    startedAt: new Date().toISOString(),
    pid: process.pid,
    files: [...inFlight].map(([path, buf]) => ({ path, originalB64: buf.toString("base64") })),
  };
  // Written then renamed, so a crash mid-write never leaves a truncated journal.
  const partial = `${JOURNAL}.partial`;
  writeFileSync(partial, JSON.stringify(journal, null, 2));
  renameSync(partial, JOURNAL);
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

/**
 * Whether the journal's writer is still running; `process.kill(pid, 0)` sends no signal. EPERM
 * means alive under another user. A recycled pid reads as alive, which errs toward refusing rather
 * than clobbering a live run.
 */
function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** What the journal on disk means for THIS invocation.
    - `none`       — no journal; nothing to do.
    - `in-flight`  — the writer is still running. Recovery would be a CLOBBER.
    - `recovered`  — the writer is gone; its files have been put back. */
type JournalDisposition = "none" | "in-flight" | "recovered";

/**
 * Recovers from a run that died where the in-process nets could not fire, then refuses to continue
 * so the user inspects the tree. A journal exists for the whole of a healthy run, so this refuses
 * without writing if the journal's pid is still alive.
 */
function recoverFromJournal(): JournalDisposition {
  if (!existsSync(JOURNAL)) return "none";
  const journal = parseJson(readFileSync(JOURNAL, "utf8"), JOURNAL, isJournal);

  // `journal.pid !== process.pid` is not paranoia about our own run — we have
  // written no journal yet — it is the pid-reuse case landing on US, where
  // refusing would make the tool permanently unusable until someone deleted a
  // file by hand.
  if (journal.pid !== process.pid && pidIsAlive(journal.pid)) {
    console.error(
      `\n🛑  A mutation run is ALREADY IN FLIGHT (pid ${journal.pid}, started ${journal.startedAt}).`,
    );
    console.error("    Refusing to recover: its journal is not wreckage, it is that run's net.");
    console.error("    Restoring from it would overwrite the mutant that run has on disk right");
    console.error("    now, and its row would report CLOBBER against this process.\n");
    for (const entry of journal.files) {
      console.error(`    in flight: ${entry.path}`);
    }
    console.error(
      "\n    Wait for it to finish, or stop it (a SIGINT/SIGTERM restores and clears).",
    );
    console.error("    If you are certain that pid is NOT this harness (pids are reused), delete");
    console.error(`    ${JOURNAL} by hand — but read it first: it holds the only copy of the`);
    console.error("    original bytes.\n");
    return "in-flight";
  }

  console.error(`\n⚠️  A previous mutation run (pid ${journal.pid}, started ${journal.startedAt})`);
  console.error("    did not restore its files. Restoring them now from the journal.\n");
  for (const entry of journal.files) {
    writeFileSync(entry.path, Buffer.from(entry.originalB64, "base64"));
    console.error(`    restored ${entry.path}`);
  }
  clearJournal();
  console.error("\n    Done. Verify with `git diff --stat`, then re-run.\n");
  return "recovered";
}

// Concurrency gate: a file with any working-tree modification is not mutated; it reports
// SKIPPED-DIRTY and fails the run. Per file rather than whole tree because this checkout is rarely
// globally clean. `--allow-dirty` overrides it for an author's own edits.
function dirtyPathsAmong(paths: string[]): string[] {
  if (paths.length === 0) return [];
  const git = spawnSync("git", ["status", "--porcelain", "--", ...paths], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  // A failed `git status` counts as dirty, so the gate fails toward refusal.
  if (git.status !== 0) return paths;
  return (
    git.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      // A rename prints "old -> new"; take the destination, which is the path on disk.
      .map((path) => (path.includes(" -> ") ? path.slice(path.indexOf(" -> ") + 4) : path))
      .map((path) => path.replace(/^"|"$/g, ""))
  );
}

let child: ReturnType<typeof spawn> | null = null;

function installNets(): void {
  process.on("exit", restoreAll);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => {
      process.stderr.write(`\n[${sig}] restoring ${inFlight.size} file(s) before exit…\n`);
      child?.kill("SIGKILL");
      restoreAll();
      process.exit(EXIT.interrupted);
    });
  }
  process.on("uncaughtException", (err) => {
    process.stderr.write(`\n[uncaught] ${String(err)}\n`);
    child?.kill("SIGKILL");
    restoreAll();
    process.exit(EXIT.findings);
  });
  process.on("unhandledRejection", (err) => {
    process.stderr.write(`\n[unhandled rejection] ${String(err)}\n`);
    child?.kill("SIGKILL");
    restoreAll();
    process.exit(EXIT.findings);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Running vitest
// ─────────────────────────────────────────────────────────────────────────────

type SuiteResult = { green: boolean; ms: number; tail: string };

/**
 * Some guards are bun scripts rather than vitest suites; `killedByCommand` runs one (argv array, no
 * shell, cwd at the repo root).
 */
function runProcess(command: string[], verbose: boolean): Promise<SuiteResult> {
  return spawnRecording(command[0] as string, command.slice(1), verbose);
}

function runVitest(
  files: string[],
  nameFilter: string | undefined,
  verbose: boolean,
): Promise<SuiteResult> {
  const args = ["vitest", "run", "--reporter=dot", ...files];
  if (nameFilter !== undefined) args.push("-t", nameFilter);
  return spawnRecording("bunx", args, verbose);
}

function spawnRecording(bin: string, args: string[], verbose: boolean): Promise<SuiteResult> {
  const started = Date.now();
  return new Promise((resolvePromise) => {
    const proc = spawn(bin, args, {
      cwd: REPO_ROOT,
      stdio: verbose ? "inherit" : ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1", FORCE_COLOR: "0", VITEST_MODULE_CACHE_PATH: MODULE_CACHE },
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

function baselineKey(
  files: string[],
  nameFilter: string | undefined,
  command: string[] | undefined,
): string {
  return command === undefined
    ? `${files.join("|")}::${nameFilter ?? ""}`
    : `!${command.join(" ")}`;
}

function isJsonReport(v: unknown): v is { testResults: { name: string }[] } {
  return (
    isRecord(v) &&
    Array.isArray(v.testResults) &&
    v.testResults.every((r) => isRecord(r) && typeof r.name === "string")
  );
}

/**
 * Runs the baselines of every selected suite row in one vitest process and records the keys it
 * vouches for, so only the rest get a run of their own. It vouches only when the whole run exits 0,
 * since an error outside any test fails a run without failing a file, and only for a key whose
 * filters matched a file, matching them as `vitest run` does (a case-insensitive substring of the
 * repo-relative path). Name-filtered keys keep their own run.
 */
async function batchBaselines(selected: readonly Mutant[], verbose: boolean): Promise<void> {
  const keyed = new Map<string, string[]>();
  for (const m of selected) {
    if (m.killedByCommand !== undefined || m.nameFilter !== undefined) continue;
    keyed.set(baselineKey(m.expectKilledBy, undefined, undefined), m.expectKilledBy);
  }
  if (keyed.size < 2) return;
  const filters = [...new Set([...keyed.values()].flat())];
  process.stdout.write(`  baselines: ${keyed.size} suite set(s) in one run … `);
  const report = join(REPO_ROOT, "tmp", `mutation-baseline-${process.pid}.json`);
  mkdirSync(dirname(report), { recursive: true });
  let ran: string[] = [];
  let run: SuiteResult;
  try {
    run = await spawnRecording(
      "bunx",
      [
        "vitest",
        "run",
        "--reporter=dot",
        "--reporter=json",
        `--outputFile.json=${report}`,
        ...filters,
      ],
      verbose,
    );
    if (run.green) {
      ran = parseJson(readFileSync(report, "utf8"), report, isJsonReport).testResults.map((r) =>
        relative(REPO_ROOT, r.name).toLowerCase(),
      );
    }
  } finally {
    rmSync(report, { force: true });
  }
  let vouched = 0;
  for (const [key, files] of keyed) {
    const lowered = files.map((f) => f.toLowerCase());
    if (!ran.some((file) => lowered.some((f) => file.includes(f)))) continue;
    baselineCache.set(key, { green: true, ms: 0, tail: "" });
    vouched++;
  }
  console.log(
    `${run.green ? "green" : "RED, so every suite set runs its own"} · ${vouched} vouched · ${(run.ms / 1000).toFixed(1)}s`,
  );
}

async function baselineFor(
  files: string[],
  nameFilter: string | undefined,
  command: string[] | undefined,
  verbose: boolean,
) {
  const key = baselineKey(files, nameFilter, command);
  const hit = baselineCache.get(key);
  if (hit !== undefined) return hit;
  const result =
    command === undefined
      ? await runVitest(files, nameFilter, verbose)
      : await runProcess(command, verbose);
  baselineCache.set(key, result);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// One mutant
// ─────────────────────────────────────────────────────────────────────────────

type Verdict =
  | "KILLED" // no `survives`, suite went red — as declared
  | "SURVIVED" // no `survives`, suite stayed green: a gap
  | "SURVIVES(known)" // `survives` declared, suite stayed green — as declared
  | "STALE-SURVIVOR" // `survives` declared, suite went red: the reason is stale
  | "SKIPPED-DIRTY" // another agent owns this file; not a pass
  | "CLOBBER" // something wrote the file while it was mutated
  | "ERROR"; // the row itself is broken: stale `find`, or a red baseline

/** The verdict once a mutant has run, keyed by [declared survivor][suite went red]. */
const OUTCOME = {
  declared: { killed: "STALE-SURVIVOR", green: "SURVIVES(known)" },
  undeclared: { killed: "KILLED", green: "SURVIVED" },
} as const satisfies Record<string, Record<string, Verdict>>;

type RunOptions = {
  /** Ignore `expectKilledBy` and run the whole suite. */
  full: boolean;
  /** Stream the suite's output. */
  verbose: boolean;
  /** Mutate files that have uncommitted changes. */
  allowDirty: boolean;
};

type Row = {
  mutant: Mutant;
  verdict: Verdict;
  ms: number;
  note: string;
};

async function runMutant(mutant: Mutant, { full, verbose, allowDirty }: RunOptions): Promise<Row> {
  const absolute = resolve(REPO_ROOT, mutant.file);
  if (!absolute.startsWith(`${REPO_ROOT}/`)) {
    return { mutant, verdict: "ERROR", ms: 0, note: `path escapes the repo: ${mutant.file}` };
  }
  if (!existsSync(absolute)) {
    return { mutant, verdict: "ERROR", ms: 0, note: `file does not exist: ${mutant.file}` };
  }

  const original = readFileSync(absolute);
  const text = original.toString("utf8");

  const occurrences = text.split(mutant.find).length - 1;

  // Dirty-file refusal, which still reports the `find` count so a skipped row shows a stale one.
  if (!allowDirty && dirtyPathsAmong([mutant.file]).length > 0) {
    return {
      mutant,
      verdict: "SKIPPED-DIRTY",
      ms: 0,
      // `.join("")` rather than `+` so Biome's `useTemplate` fix does not collapse the wrapped
      // prose.
      note: [
        `${mutant.file} has uncommitted working-tree changes — another agent may be mid-edit, `,
        `so this harness will not write to it. (\`find\` currently occurs ${occurrences}×.) `,
        "Commit or set the file aside, or re-run with --allow-dirty if the changes are yours.",
      ].join(""),
    };
  }

  // Zero matches means the row is stale (an error, never a skip); two or more means the site is
  // ambiguous.
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

  // A `killedByCommand` row names its own killer, so `--full` has nothing wider
  // to widen to and is ignored rather than silently running vitest over a mutant
  // no vitest suite was ever claimed to catch.
  const command = mutant.killedByCommand;
  const files = full || command !== undefined ? [] : mutant.expectKilledBy;
  const nameFilter = full || command !== undefined ? undefined : mutant.nameFilter;

  // A green baseline is a PRECONDITION, not a nicety. Without it, "the suite
  // went red" could just mean the suite was already red — which, with a sibling
  // agent editing `packages/engine/src` in the same tree, is a live hazard.
  const baseline = await baselineFor(files, nameFilter, command, verbose);
  if (!baseline.green) {
    return {
      mutant,
      verdict: "ERROR",
      ms: baseline.ms,
      note: `baseline is RED before mutating — no verdict is meaningful. Suites: ${command?.join(" ") ?? files.join(" ")}`,
    };
  }

  // Re-checked right before the write, since the baseline run can take a minute.
  if (!allowDirty && dirtyPathsAmong([mutant.file]).length > 0) {
    return {
      mutant,
      verdict: "SKIPPED-DIRTY",
      ms: baseline.ms,
      note: `${mutant.file} became dirty during the baseline run — refusing to write to it.`,
    };
  }

  const mutatedText = applyMutant(text, mutant.find, mutant.replace);
  const cachedModules = moduleCacheEntries();
  let mutated: SuiteResult;
  let clobberedTo: string | null = null;
  try {
    inFlight.set(absolute, original);
    writeJournal(); // journal BEFORE the file changes, never after
    writeFileSync(absolute, mutatedText);
    mutated =
      command === undefined
        ? await runVitest(files, nameFilter, verbose)
        : await runProcess(command, verbose);
  } finally {
    // Another writer could change the file during the mutation window, so compare before restoring
    // and keep a copy of any interloping version beside the journal.
    const onDisk = readFileSync(absolute);
    if (!onDisk.equals(Buffer.from(mutatedText))) {
      const rescue = `${JOURNAL}.clobbered-${Date.now()}`;
      writeFileSync(rescue, onDisk);
      clobberedTo = rescue;
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
    dropModuleCacheEntriesBesides(cachedModules);
  }

  // A clobber overrides the mutant's verdict and fails the run, since the file under test changed
  // mid-run.
  if (clobberedTo !== null) {
    return {
      mutant,
      verdict: "CLOBBER",
      ms: mutated.ms,
      note: [
        `${mutant.file} was written by another process during the mutation window. `,
        `That version is preserved at ${clobberedTo}; the bytes on disk are the ones this `,
        "harness read at the start. RECOVER IT BY HAND before doing anything else.",
      ].join(""),
    };
  }

  const verdict: Verdict =
    OUTCOME[mutant.survives === undefined ? "undeclared" : "declared"][
      mutated.green ? "green" : "killed"
    ];

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

  // Argument validation runs first, before `--list` and journal recovery, so a bad command line
  // reads and writes nothing.
  const problems = argvProblems(argv);
  if (problems.length > 0) {
    console.error("\n🛑 mutation harness: the command line was REJECTED. Nothing ran.\n");
    for (const problem of problems) console.error(`   • ${problem}`);
    console.error(`\n   valid flags: ${knownFlagsUsage()}`);
    console.error("   rows are selected with `--only <id>[,<id>…]` or `--decision D<nnn>`.\n");
    process.exit(EXIT.badArgv);
  }

  // `--list` is read-only, so it is answered before journal recovery, which writes.
  if (argv.includes("--list")) {
    for (const mutant of MUTANTS) {
      const tag =
        mutant.survives === undefined ? "" : `  [known survivor: ${mutant.survives.kind}]`;
      console.log(`${mutant.id.padEnd(22)} ${mutant.decision.padEnd(22)} ${mutant.what}${tag}`);
      const killers = mutant.killedByCommand?.join(" ") ?? mutant.expectKilledBy.join(", ");
      console.log(`${" ".repeat(22)} ${mutant.file} → ${killers}`);
    }
    return;
  }

  const journalState = recoverFromJournal();
  if (journalState === "in-flight") process.exit(EXIT.inFlight);
  if (journalState === "recovered") process.exit(EXIT.recovered);

  const only = flagValue(argv, "--only")?.split(",");
  const decision = flagValue(argv, "--decision");
  const options: RunOptions = {
    full: argv.includes("--full"),
    verbose: argv.includes("--verbose"),
    allowDirty: argv.includes("--allow-dirty"),
  };
  const { full, allowDirty } = options;

  const selected = MUTANTS.filter(
    (m) =>
      (only === undefined || only.includes(m.id)) &&
      (decision === undefined || m.decision.includes(decision)),
  );
  if (selected.length === 0) {
    console.error("No mutants selected.");
    process.exit(EXIT.noSelection);
  }

  installNets();

  console.log(
    `\nMutation harness (D211) — ${selected.length} mutant(s)${full ? ", FULL suite" : ""}\n`,
  );

  // Say up front which rows this run is NOT going to answer for, and why. The
  // failure this replaces is a table that looks complete because the skips are
  // only visible one column over.
  const dirty = dirtyPathsAmong([...new Set(selected.map((m) => m.file))]);
  if (dirty.length > 0) {
    console.log(
      allowDirty
        ? `⚠️  --allow-dirty: mutating ${dirty.length} file(s) with uncommitted changes:\n${dirty.map((f) => `      ${f}`).join("\n")}\n`
        : `⚠️  ${dirty.length} target file(s) have uncommitted changes and will be SKIPPED\n    (another agent may be editing them — see the D215 block in this file):\n${dirty.map((f) => `      ${f}`).join("\n")}\n`,
    );
  }

  const rows: Row[] = [];
  const started = Date.now();
  if (!full) await batchBaselines(selected, options.verbose);
  for (const mutant of selected) {
    process.stdout.write(`  ${mutant.id.padEnd(26)} … `);
    const row = await runMutant(mutant, options);
    rows.push(row);
    console.log(`${row.verdict.padEnd(16)} ${(row.ms / 1000).toFixed(1)}s`);
  }
  const totalMs = Date.now() - started;

  // ── the table ──
  console.log(`\n${"─".repeat(84)}`);
  console.log(
    `${cell("MUTANT", 26)}${cell("FROM", 22)}${cell("VERDICT", 17)}${cell("TIME", 8)}SUITES`,
  );
  console.log("─".repeat(84));
  for (const row of rows) {
    console.log(
      `${cell(row.mutant.id, 26)}${cell(row.mutant.decision, 22)}${cell(row.verdict, 17)}${cell(`${(row.ms / 1000).toFixed(1)}s`, 8)}${row.mutant.killedByCommand === undefined ? row.mutant.expectKilledBy.length : "cmd"}`,
    );
  }
  console.log("─".repeat(84));

  const byVerdict = (verdict: Verdict): Row[] => rows.filter((r) => r.verdict === verdict);
  const killed = byVerdict("KILLED");
  const known = byVerdict("SURVIVES(known)");
  const gaps = byVerdict("SURVIVED");
  const stale = byVerdict("STALE-SURVIVOR");
  const skipped = byVerdict("SKIPPED-DIRTY");
  const clobbered = byVerdict("CLOBBER");
  const errors = byVerdict("ERROR");

  console.log(
    `${killed.length} killed · ${known.length} known survivor(s) · ${gaps.length} GAP(S) · ${stale.length} stale · ${skipped.length} skipped(dirty) · ${clobbered.length} clobber(s) · ${errors.length} error(s) · ${(totalMs / 1000).toFixed(1)}s total\n`,
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
  for (const row of skipped) {
    console.log(`\n⏭  SKIPPED-DIRTY — ${row.mutant.id}  [${row.mutant.decision}]`);
    console.log(`    ${row.note}`);
  }
  for (const row of clobbered) {
    console.log(`\n🛑 CLOBBER — ${row.mutant.id}  [${row.mutant.decision}]`);
    console.log(`    ${row.note}`);
  }
  for (const row of errors) {
    console.log(`\n⚠️  ERROR — ${row.mutant.id}: ${row.note}`);
  }

  // Skipped mutants count against the run.
  const findings = gaps.length + stale.length + errors.length + skipped.length + clobbered.length;
  process.exit(findings === 0 ? EXIT.ok : EXIT.findings);
}

await main();
