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
 *        🛑 BUT A JOURNAL IS NOT EVIDENCE OF A CRASH (D411). It is present for
 *        the WHOLE of a healthy run — written before the first file change,
 *        cleared only at the last restore — so "a journal exists" and "a run
 *        died" are different propositions. Startup therefore asks whether the
 *        journal's PID IS STILL ALIVE and, if it is, refuses without writing a
 *        byte (exit 3). Recovering from a LIVE run's journal is not recovery,
 *        it is the clobber this whole section exists to prevent.
 *
 * ─── WHAT THIS DOES NOT PROVE ────────────────────────────────────────────────
 *   • It does not measure coverage, and a green table is NOT "the suite is
 *     good". It says: these forty-two specific defects, on these specific lines,
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
 *   • ⚠️ It says NOTHING about a mutant reported SKIPPED-DIRTY. See the D215
 *     block below: a file with uncommitted changes is not mutated at all, so a
 *     run in a busy checkout answers for a SUBSET of the corpus and says which.
 *
 * ─── CONCURRENCY (D215) — WHY THIS TOOL IS ALLOWED TO TOUCH A SHARED TREE ────
 * This repo runs two or three agents in ONE working tree, and a tool that can
 * eat a colleague's uncommitted work is worse than no tool. D211's answer was to
 * detect a clobber after the fact and warn. That is not enough (the assessment
 * is written out in full at `dirtyPathsAmong` below), so D215 adds:
 *   • a PER-FILE refusal, re-checked immediately before the write: any target
 *     with working-tree changes reports SKIPPED-DIRTY and is never written to;
 *   • a failing verdict (CLOBBER) rather than a stderr warning when something
 *     does write during the window;
 *   • both counting against the exit code, so "not checked" cannot read green.
 * `--allow-dirty` overrides the refusal for an author working on their own edit.
 *
 * ─── WHERE THIS SCRIPT SITS ──────────────────────────────────────────────────
 * Outside `tsc -b` and outside the vitest `include` globs, following the
 * precedent of `apps/api/scripts/ingest.ts` and `packages/schema/scripts/
 * validate-live.ts` — a dev tool has no business in the app's build graph or in
 * the suite it is meant to be an independent check on. Bun runs the TypeScript
 * directly. ⚠️ D211 recorded here that repo-root `scripts/**` was covered by
 * NEITHER `biome.json` nor the `lint` script's argument list, so this file was
 * unlinted. THAT IS NO LONGER TRUE and the amendment is the point: D212 widened
 * `files.include` to `scripts/**` + `vite.config.ts`, pointed `lint`/`lint:ci`/
 * `format` at `.`, and made the coverage a COMMAND (`bun run lint:coverage`,
 * a step of `bun run check`) rather than a sentence in a header like this one.
 * Two of that guard's own mutants are in the corpus below. See
 * `docs/conventions.md`.
 *
 * ─── USAGE ───────────────────────────────────────────────────────────────────
 *   bun run mutants                 # every mutant
 *   bun run mutants --list          # print the corpus, run nothing
 *   bun run mutants --only D192-weakness,D196-seat-zone
 *   bun run mutants --decision D202 # every mutant transcribed from one row
 *   bun run mutants --full          # ignore expectKilledBy, run the whole suite
 *                                   # (~70s per mutant — the honest slow check)
 *   bun run mutants --verbose       # stream vitest output
 *   bun run mutants --allow-dirty   # ⚠️ mutate files with uncommitted changes
 *                                   # (only when those changes are YOURS)
 *
 * Exit code is 0 only when every mutant matched its declaration; 2 when a dead
 * run's journal was recovered (the tree changed — go look); 3 when another run
 * is already in flight and nothing was touched (D411).
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MUTANTS, type Mutant } from "./mutants.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** 🛑 D411 — OVERRIDABLE FOR ONE REASON: the guard for the liveness gate cannot
    otherwise exist. `recovery-gate.ts` drives this CLI as a child process, and
    the harness that RUNS that guard (via `killedByCommand`) has its own journal
    in flight the whole time — so a guard pointed at the real path would either
    read the harness's journal or write over it, which is the D411 defect wearing
    the guard's clothes. An env override gives the guard a private path and keeps
    its blast radius inside a temp dir. Unset in every other invocation, which is
    every invocation a human or CI makes. */
const JOURNAL =
  process.env.MUTATION_JOURNAL_PATH ?? join(REPO_ROOT, "tmp", "mutation-journal.json");

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

/** Is the process that wrote the journal still running? `process.kill(pid, 0)`
    sends NO signal — it only asks the kernel whether the pid is addressable.
    `ESRCH` means gone; `EPERM` means alive and owned by another user, which is
    still ALIVE and is the answer that matters here.

    ⚠️ PIDS ARE REUSED, AND THIS FUNCTION CANNOT SEE THAT. A dead run whose pid
    has been recycled by an unrelated process reads as alive, and the recovery
    then refuses instead of restoring. That is the FAILURE DIRECTION CHOSEN: a
    false "alive" costs one `rm` the message names, and a false "dead" is the
    defect D411 exists to remove. `startedAt` is not a tie-break either — it is
    the JOURNAL's clock, not the process's, so comparing it to anything would be
    inventing precision the record does not carry. */
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

/** Recover from a run that died where none of the in-process nets could fire
    (SIGKILL, OOM, container loss). Refuses to continue afterwards on purpose:
    the tree just changed under the user, and they should look at it.

    🛑 D411 — THE LIVENESS GATE, AND IT IS D369's REPAIR FINISHED AT THE CLASS
    RATHER THAN AT THE INSTANCE. The journal is written BEFORE every file change
    and cleared only at restore, so it is present for the WHOLE of a healthy run:
    "a journal exists" and "a run died" are not the same proposition, and until
    now this function conflated them. D369 found that conflation through
    `--list`, whose fix was to answer the read-only command BEFORE the recovery —
    correct, and about the one command that had no business writing at all. Every
    WRITING invocation still walked in: a second `bun run mutants`, a
    `--decision X` probe, or an agent following this file's own recovery advice
    would restore the live run's target out from under it, DELETE the journal
    that was its last `kill -9` net, and leave the in-flight row reporting
    CLOBBER against a phantom "another process".

    ⚠️ MEASURED THE SAME WAY D369's WAS, AND THAT IS WHY IT WAS FINDABLE TWICE:
    the preserved "clobbered" file is BYTE-IDENTICAL TO HEAD, which is the
    signature of a RESTORE rather than of an edit. It cost the D410 whole-corpus
    sweep one row (`D376-discard-threshold-note-drifts-off-the-clause`) 78
    minutes into an 89-minute run, and the row came back KILLED on a targeted
    re-run — so the verdict was never in doubt, only the 89 minutes.

    ⚠️ THE REFUSAL IS THE POINT, NOT A CONVENIENCE. It exits non-zero and writes
    nothing, because "another run is in flight" is exactly the state in which
    this tool's one guarantee — that a tree carrying somebody's uncommitted work
    comes out the way it went in — is at stake. */
function recoverFromJournal(): JournalDisposition {
  if (!existsSync(JOURNAL)) return "none";
  const journal = JSON.parse(readFileSync(JOURNAL, "utf8")) as Journal;

  // `journal.pid !== process.pid` is not paranoia about our own run — we have
  // written no journal yet — it is the pid-reuse case landing on US, where
  // refusing would make the tool permanently unusable until someone deleted a
  // file by hand.
  if (journal.pid !== process.pid && pidIsAlive(journal.pid)) {
    console.error(`\n🛑  A mutation run is ALREADY IN FLIGHT (pid ${journal.pid}, started ${journal.startedAt}).`);
    console.error("    Refusing to recover: its journal is not wreckage, it is that run's net.");
    console.error("    Restoring from it would overwrite the mutant that run has on disk right");
    console.error("    now, and its row would report CLOBBER against this process.\n");
    for (const entry of journal.files) {
      console.error(`    in flight: ${entry.path}`);
    }
    console.error("\n    Wait for it to finish, or stop it (a SIGINT/SIGTERM restores and clears).");
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

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ THE CONCURRENCY GATE (D215) — the reason this tool is allowed to exist
// ─────────────────────────────────────────────────────────────────────────────
/**
 * D211 shipped ONE mitigation for concurrent agents: after the vitest run it
 * compared the on-disk bytes to what it had written and, on a mismatch, rescued
 * the interloping version beside the journal and printed a warning. D215's
 * assessment is that THAT IS NOT SUFFICIENT, for two independent reasons:
 *
 *   1. IT IS PURELY AFTER-THE-FACT. It fires only once the damage is done, and
 *      the recovery it offers is a file with a timestamp in its name that the
 *      other agent will never look for. A warning on stderr of a tool that
 *      prints a 25-row table is not a recovery mechanism.
 *   2. IT DOES NOT SEE THE COMMON CASE AT ALL. The likely failure is not a write
 *      landing inside the ~2 s mutation window; it is mutating a file that
 *      ALREADY holds a sibling's uncommitted work. Then the sequence is:
 *      read dirty bytes → write mutant → write dirty bytes back. Byte-identical
 *      round trip, no warning, no harm — UNLESS the sibling saves during the
 *      window, in which case case 1 applies; or unless their editor/tooling has
 *      the file open and rewrites from a stale buffer. More sharply: the mutant
 *      is being applied to code that is HALF-EDITED, so its verdict is a fact
 *      about nobody's program, and `find` moving under it reports ERROR
 *      ("re-transcribe the row") when the row is perfectly good.
 *
 * So the gate is PER FILE and it is a REFUSAL, checked immediately before the
 * write (the tightest window available). A file with any working-tree
 * modification — staged, unstaged, or untracked — is not mutated at all; the
 * mutant reports SKIPPED-DIRTY and the run exits non-zero, because "I did not
 * check this" must never read as green.
 *
 * ⚠️ WHY PER FILE AND NOT A WHOLE-TREE REFUSAL. A whole-tree gate is simpler and
 * was the obvious answer, but it makes the tool unusable in exactly the repo it
 * was written for: this checkout has had two or three agents in it continuously,
 * and it is almost never globally clean. It would also be a WORSE guarantee for
 * no benefit — a clean tree at startup says nothing about a file dirtied at
 * minute four. The per-file check is strictly tighter in time and strictly more
 * useful, and it lets the engine half of the corpus run while `src/**` is live.
 *
 * `--allow-dirty` overrides it, for the one legitimate case: an author iterating
 * on their OWN uncommitted change who wants to know whether their new test kills
 * a mutant. It prints a banner naming every dirty file it is about to touch.
 */
function dirtyPathsAmong(paths: string[]): string[] {
  if (paths.length === 0) return [];
  const git = spawnSync("git", ["status", "--porcelain", "--", ...paths], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  // ⚠️ A FAILED `git status` IS TREATED AS DIRTY, NOT AS CLEAN. If we cannot
  // establish that a file is safe to overwrite, we do not overwrite it — the
  // whole point of the gate is that its failure mode is refusal.
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

/**
 * D215 — NOT EVERY GUARD IN THIS REPO IS A VITEST SUITE. D212's lint-coverage
 * guard is a `bun` script, and its decision row publishes a three-way mutation
 * tally over `biome.json` exactly like every engine row publishes one over the
 * suite. Transcribing those rows needs the runner to be able to spawn something
 * other than vitest; `killedByCommand` is that, and it is deliberately the only
 * escape hatch (no shell, an argv array, cwd pinned to the repo root).
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

async function baselineFor(
  files: string[],
  nameFilter: string | undefined,
  command: string[] | undefined,
  verbose: boolean,
) {
  const key =
    command === undefined ? `${files.join("|")}::${nameFilter ?? ""}` : `!${command.join(" ")}`;
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
  | "SURVIVED" // ⚠️ no `survives`, suite stayed green — A GAP, or a false tally
  | "SURVIVES(known)" // `survives` declared, suite stayed green — as declared
  | "STALE-SURVIVOR" // ⚠️ `survives` declared, suite went red — the reason rotted
  | "SKIPPED-DIRTY" // D215: a sibling agent owns this file right now. NOT a pass.
  | "CLOBBER" // ⚠️ D215: something wrote the file while it was mutated.
  | "ERROR"; // the row itself is broken: stale `find`, or a red baseline

type Row = {
  mutant: Mutant;
  verdict: Verdict;
  ms: number;
  note: string;
};

async function runMutant(
  mutant: Mutant,
  full: boolean,
  verbose: boolean,
  allowDirty: boolean,
): Promise<Row> {
  const absolute = resolve(REPO_ROOT, mutant.file);
  if (!absolute.startsWith(`${REPO_ROOT}/`)) {
    return { mutant, verdict: "ERROR", ms: 0, note: `path escapes the repo: ${mutant.file}` };
  }
  if (!existsSync(absolute)) {
    return { mutant, verdict: "ERROR", ms: 0, note: `file does not exist: ${mutant.file}` };
  }

  const original = readFileSync(absolute);
  const text = original.toString("utf8");

  // ⚠️ D215 — THE DIRTY-FILE REFUSAL, CHECKED BEFORE ANYTHING ELSE THAT MATTERS.
  // The uniqueness check below is run FIRST ANYWAY, read-only, so a skipped row
  // still reports whether it has rotted — a skip that hides a stale `find` would
  // let the corpus decay silently, which is the one thing this harness exists to
  // stop. But nothing is WRITTEN to a file somebody else is holding.
  const occurrencesNow = text.split(mutant.find).length - 1;
  if (!allowDirty && dirtyPathsAmong([mutant.file]).length > 0) {
    return {
      mutant,
      verdict: "SKIPPED-DIRTY",
      ms: 0,
      // `.join("")` and not `+`, per D212: Biome's `useTemplate` fix collapses a
      // concatenation into one 300-column line, and this prose is wrapped on
      // purpose.
      note: [
        `${mutant.file} has uncommitted working-tree changes — another agent may be mid-edit, `,
        `so this harness will not write to it. (\`find\` currently occurs ${occurrencesNow}×.) `,
        "Commit or set the file aside, or re-run with --allow-dirty if the changes are yours.",
      ].join(""),
    };
  }

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
      note: `baseline is RED before mutating — no verdict is meaningful. Suites: ${command?.join(" ") ?? files.join(" ") ?? ""}`,
    };
  }

  // ⚠️ RE-CHECKED HERE, NOT ONLY ABOVE. The baseline run above can take a minute,
  // and a sibling can start editing inside it. This is the last instant before
  // the write, which is the tightest window this design can offer.
  if (!allowDirty && dirtyPathsAmong([mutant.file]).length > 0) {
    return {
      mutant,
      verdict: "SKIPPED-DIRTY",
      ms: baseline.ms,
      note: `${mutant.file} became dirty during the baseline run — refusing to write to it.`,
    };
  }

  // 🆕🆕 **D470 — A FUNCTION REPLACEMENT, BECAUSE `String.replace` INTERPRETS `$` IN THE
  // REPLACEMENT AND THE CORPUS IS FULL OF `$`.** With a string second argument, `$&`,
  // `` $` ``, `$'` and `$1` are SPLICE DIRECTIVES, so a row whose `replace` carries a
  // regex `…$` immediately followed by a backtick — which is how every anchor row in this
  // corpus quotes a pattern in its own doc comment — writes the ENTIRE PRECEDING FILE into
  // the mutant. Measured at this head: **11 of 2,111 rows** were corrupted this way, ten of
  // them since **D234**, each producing a file 0.6–1.7 MB larger than the declared mutation.
  // 🛑 **AND THE CORRUPTION LOOKED LIKE SUCCESS**: the spliced file does not parse, vitest
  // exits non-zero, and the row reports KILLED — D416's *a row that dies for the wrong
  // reason is worth less than one that survives, because it reports success* — while a
  // DECLARED SURVIVOR reports a spurious `STALE-SURVIVOR` and fails the run. All ten
  // pre-existing rows were re-measured by applying their replacement LITERALLY and running
  // their own `expectKilledBy`: all ten are genuinely KILLED, so this fix changes no
  // verdict. `docs/conventions.md` has required a function replacement of every hand-written
  // probe since D462; the harness itself never got the rule. `precheck.ts` now checks the
  // property over the whole corpus so the class cannot come back silently.
  const mutatedText = text.replace(mutant.find, () => mutant.replace);
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
  }

  // ⚠️ D215 — A CLOBBER IS A RESULT, NOT A WARNING. D211 wrote a line to stderr
  // and then reported the mutant's verdict as if nothing had happened, so a run
  // that overwrote a colleague's save still ended "16 killed · 0 gaps" and exited
  // 0. It now takes over the verdict and fails the run: the mutant's answer is
  // untrustworthy anyway (the file under test changed mid-run), and somebody has
  // to go look at the rescued copy.
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

  // 🛑 D369 — `--list` IS READ-ONLY AND IT IS ANSWERED *BEFORE* THE JOURNAL
  // RECOVERY, WHICH IS NOT WHERE IT USED TO SIT. `recoverFromJournal()` ran first
  // for EVERY invocation, so `bun run mutants --list` — documented above as
  // "print the corpus, run nothing" — would find the journal a *live* run had
  // written before its own file write, RESTORE that run's target file out from
  // under it, clear the journal and exit 2. The in-flight mutant then found bytes
  // it had not written and reported **CLOBBER**, naming a phantom "another
  // process".
  //
  // ⚠️ MEASURED, NOT REASONED: this cost a real `--decision D275` run in the D369
  // session, whose preserved "clobbered" file turned out to be byte-identical to
  // HEAD — which is the signature of a RESTORE rather than of an edit, and the
  // only reason the cause was findable. **THE RECOVERY PATH IS A WRITE, SO THE
  // ONLY COMMAND THAT MAY PRECEDE IT IS ONE THAT NEVER WRITES.**
  if (argv.includes("--list")) {
    for (const mutant of MUTANTS) {
      const tag =
        mutant.survives === undefined ? "" : `  [known survivor: ${mutant.survives.kind}]`;
      console.log(`${mutant.id.padEnd(22)} ${mutant.decision.padEnd(22)} ${mutant.what}${tag}`);
      console.log(`${" ".repeat(22)} ${mutant.file} → ${mutant.expectKilledBy.join(", ")}`);
    }
    return;
  }

  // 🛑 D411 — TWO DIFFERENT EXITS, BECAUSE THEY ARE TWO DIFFERENT FACTS AND THE
  // EXIT CODE IS THE ONLY PART OF THIS OUTPUT A SCRIPT READS. `2` means "a dead
  // run's files were put back, go look at the tree"; `3` means "somebody else is
  // mid-run, nothing was touched". Collapsing them would tell an automated caller
  // to inspect a tree that never changed.
  const journalState = recoverFromJournal();
  if (journalState === "in-flight") process.exit(3);
  if (journalState === "recovered") process.exit(2);

  const only = flagValue(argv, "--only")?.split(",");
  const decision = flagValue(argv, "--decision");
  const full = argv.includes("--full");
  const verbose = argv.includes("--verbose");
  const allowDirty = argv.includes("--allow-dirty");

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
  for (const mutant of selected) {
    process.stdout.write(`  ${mutant.id.padEnd(26)} … `);
    const row = await runMutant(mutant, full, verbose, allowDirty);
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

  const killed = rows.filter((r) => r.verdict === "KILLED");
  const known = rows.filter((r) => r.verdict === "SURVIVES(known)");
  const gaps = rows.filter((r) => r.verdict === "SURVIVED");
  const stale = rows.filter((r) => r.verdict === "STALE-SURVIVOR");
  const skipped = rows.filter((r) => r.verdict === "SKIPPED-DIRTY");
  const clobbered = rows.filter((r) => r.verdict === "CLOBBER");
  const errors = rows.filter((r) => r.verdict === "ERROR");

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

  // ⚠️ SKIPS COUNT AGAINST THE RUN. A mutant this harness declined to check is
  // not a mutant that passed, and the exit code is the only part of this output
  // a CI step reads.
  process.exit(
    gaps.length + stale.length + errors.length + skipped.length + clobbered.length === 0 ? 0 : 1,
  );
}

await main();
