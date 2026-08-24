/**
 * D411 — THE GUARD FOR THE JOURNAL LIVENESS GATE, AND IT IS A PAIR ON PURPOSE.
 *
 * `recoverFromJournal()` in `run.ts` has to answer two questions that look like
 * one: *is there a journal* and *did the run that wrote it die*. Until D411 it
 * answered only the first, so a second invocation restored a LIVE run's target
 * file out from under it, deleted the journal that was that run's last `kill -9`
 * net, and left the in-flight row reporting CLOBBER against a phantom process.
 *
 * ─── WHY A SCRIPT AND NOT A VITEST SUITE ─────────────────────────────────────
 * `scripts/**` is deliberately outside `tsc -b`'s project references and outside
 * vitest's `include` globs (conventions.md, "Where dev scripts sit"): a harness
 * meant to check the suite has no business inside it. D212's lint-coverage guard
 * set the precedent — a guard that is a SCRIPT is named from a mutant row's
 * `killedByCommand` instead of its `expectKilledBy`. This is the second.
 *
 * ─── WHY BOTH HALVES, AND WHY THAT IS THE WHOLE DESIGN ───────────────────────
 * 🛑 A GUARD THAT ONLY ASSERTS THE REFUSAL IS ONE `return "in-flight"` AWAY FROM
 * VACUOUS. Hard-wire the gate to refuse always and the refusal half passes
 * forever — while the journal net this file exists to protect stops working
 * entirely, because a genuinely crashed run could never be recovered again. So
 * the second half is the ATTRIBUTION CONTROL (D214's rule): the SAME journal,
 * the SAME command, the only difference being whether the pid is alive. One must
 * refuse and leave every byte alone; the other must restore and clear. Either
 * one alone is satisfiable by a constant.
 *
 * ⚠️ THE SUBJECT FILE LIVES OUTSIDE THE REPO. A journal entry is an absolute
 * path and recovery writes to it blindly, so pointing this at a repo file would
 * make a crashed run of THIS script a source of exactly the damage it checks
 * for. The blast radius is one file in a temp dir.
 *
 * ⚠️ AND IT NEVER TOUCHES THE REAL JOURNAL — it drives the CLI with
 * `MUTATION_JOURNAL_PATH` pointed into its own temp dir. That is not tidiness,
 * it is what lets this guard be a `killedByCommand` KILLER at all: the harness
 * running it has a journal of its own in flight for the whole window, so a guard
 * sharing the path would either read that journal or write over it — the D411
 * defect committed by the guard for the D411 defect. Hermetic by construction,
 * so it is also safe to run beside a live sweep.
 *
 *   bun scripts/mutation/recovery-gate.ts
 *
 * ─── AND A THIRD RUNG, FOR THE OTHER REASON A PID CAN THROW ──────────────────
 * `process.kill(pid, 0)` throws for two OPPOSITE reasons: `ESRCH` (gone) and
 * `EPERM` (alive, owned by somebody else). Halves one and two only ever exercise
 * the same-user path, so a `pidIsAlive` that collapsed the `catch` into `false`
 * would pass both — measured, as an undeclared SURVIVOR, before this rung existed.
 * Rung three points the journal at a FOREIGN-OWNED pid (pid 1, root) and requires
 * the same refusal.
 *
 * ⚠️ IT STATES ITS OWN PRECONDITION RATHER THAN ASSUMING IT. The rung is only
 * meaningful if that pid really answers `EPERM` for this user, so it PROBES first
 * and, on a uid-0 machine where nothing is foreign, prints that it did not run
 * instead of passing quietly. A rung that cannot fail must say so out loud.
 *
 * Exit 0 when every rung that ran held. Non-zero, naming the rung, otherwise.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUNNER = join(REPO_ROOT, "scripts", "mutation", "run.ts");

/** The private journal this guard drives the CLI against. Assigned in `main`,
    inside the temp dir, so nothing here can reach `tmp/mutation-journal.json`. */
let JOURNAL = "";

/** The two byte-strings the whole check turns on: what the journal claims the
    file held, and what is actually on disk while the "run" is mid-mutation. */
const ORIGINAL = "the original bytes\n";
const MUTANT = "the mutated bytes\n";

const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    console.log(`  ✓ ${label}`);
    return;
  }
  const line = `${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
  console.log(`  ✗ ${line}`);
  failures.push(line);
}

function writeJournalNaming(pid: number, subject: string): void {
  writeFileSync(
    JOURNAL,
    JSON.stringify(
      {
        startedAt: new Date().toISOString(),
        pid,
        files: [{ path: subject, originalB64: Buffer.from(ORIGINAL).toString("base64") }],
      },
      null,
      2,
    ),
  );
}

/** Invoke the real CLI the way a second agent would. `--only` names a row that
    does not exist on purpose: BOTH outcomes under test are decided before the
    corpus is ever filtered, so no mutant is applied either way and the exit code
    is the gate's alone. */
function runHarness(): number {
  const result = spawnSync("bun", [RUNNER, "--only", "D411-no-such-row"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, MUTATION_JOURNAL_PATH: JOURNAL },
  });
  return result.status ?? -1;
}

/** A pid that is ALIVE but not ours — so `process.kill(pid, 0)` throws `EPERM`
    rather than succeeding or throwing `ESRCH`. pid 1 is init and always exists;
    the probe is what makes the answer a measurement instead of an assumption,
    because on a uid-0 machine pid 1 is not foreign at all. `null` means this
    machine cannot exercise that arm. */
function foreignOwnedPid(): number | null {
  try {
    process.kill(1, 0);
    return null; // reachable without permission — same user, or we are root
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM" ? 1 : null;
  }
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "d411-recovery-gate-"));
  const subject = join(dir, "subject.txt");
  JOURNAL = join(dir, "journal.json");

  // A process that is unambiguously alive for as long as we need it, and whose
  // only job is to own a pid.
  const sleeper = spawn("sleep", ["120"], { stdio: "ignore" });
  const reaped = new Promise<void>((done) => sleeper.on("exit", () => done()));

  try {
    console.log("\nD411 — journal liveness gate\n");

    // ─── HALF ONE: the writer is ALIVE. Refuse, and touch nothing. ───────────
    console.log("(1) journal names a LIVE pid — must refuse and write nothing");
    writeFileSync(subject, MUTANT);
    writeJournalNaming(sleeper.pid ?? process.pid, subject);

    check("exit code is 3 (in flight)", runHarness(), 3);
    check("the mutated bytes are still on disk", readFileSync(subject, "utf8"), MUTANT);
    check("the live run's journal survives", existsSync(JOURNAL), true);

    // ─── HALF TWO: the same journal, the writer now DEAD. Recover. ───────────
    //
    // ⚠️ `await reaped` IS LOAD-BEARING, NOT TIDINESS. Between `kill` and the
    // parent reaping it, the child is a ZOMBIE — and a zombie still answers
    // `process.kill(pid, 0)`, so the gate would correctly read it as alive and
    // this half would fail intermittently. Waiting for the `exit` event is what
    // makes the pid genuinely unaddressable.
    console.log("\n(2) the same journal, pid now DEAD — must recover and clear");
    sleeper.kill("SIGKILL");
    await reaped;

    writeJournalNaming(sleeper.pid ?? process.pid, subject);
    writeFileSync(subject, MUTANT);

    check("exit code is 2 (recovered)", runHarness(), 2);
    check("the original bytes are restored", readFileSync(subject, "utf8"), ORIGINAL);
    check("the journal is cleared", existsSync(JOURNAL), false);

    // ─── RUNG THREE: alive, and owned by SOMEBODY ELSE. Still refuse. ────────
    console.log("\n(3) journal names a FOREIGN-OWNED pid — must refuse (the EPERM arm)");
    const foreign = foreignOwnedPid();
    if (foreign === null) {
      console.log("  ⚠️ NOT RUN — no foreign-owned pid on this machine (running as uid 0?).");
      console.log("     The EPERM arm of `pidIsAlive` is unexercised here, and says so.");
    } else {
      writeJournalNaming(foreign, subject);
      writeFileSync(subject, MUTANT);

      check(`exit code is 3 for pid ${foreign} (in flight)`, runHarness(), 3);
      check("the mutated bytes are still on disk", readFileSync(subject, "utf8"), MUTANT);
      check("that run's journal survives", existsSync(JOURNAL), true);
    }
  } finally {
    // The journal lives INSIDE `dir`, so one `rmSync` takes the subject file, the
    // journal and the sleeper's leavings together. Nothing outside the temp dir
    // was ever written, so there is nothing else to undo.
    sleeper.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\n🛑 recovery-gate: ${failures.length} check(s) FAILED`);
    for (const line of failures) console.error(`   ${line}`);
    console.error("");
    process.exit(1);
  }
  console.log("\nrecovery-gate: OK — refuses a live journal, still recovers a dead one.\n");
}

await main();
