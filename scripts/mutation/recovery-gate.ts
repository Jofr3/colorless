/**
 * Guard for the journal liveness gate in `run.ts`: the same journal must be refused while its
 * writer is alive (including a foreign-owned pid, which answers EPERM) and recovered once it is
 * dead. It uses a temp-dir subject and `MUTATION_JOURNAL_PATH`, so it never touches the real
 * journal. The foreign-pid rung reports that it did not run when nothing is foreign (uid 0).
 *
 *   bun scripts/mutation/recovery-gate.ts
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { REPO_ROOT } from "../lib/repo";

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

    // Same journal, writer now dead: recover. Await the reap first, since a zombie still answers
    // `process.kill(pid, 0)`.
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
