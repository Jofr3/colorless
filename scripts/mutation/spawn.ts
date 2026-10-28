/**
 * How the harness runs a suite or a guard. Kept out of `run.ts` because that file awaits `main()`
 * at top level.
 */

import { type ChildProcess, spawn } from "node:child_process";

export type SuiteResult = {
  green: boolean;
  /** Killed at its deadline; a timed-out run is never green. */
  timedOut: boolean;
  ms: number;
  tail: string;
};

/**
 * A mutant run's deadline: five times its green baseline, never under a minute. A mutant that
 * loops forever is a behaviour change the suite detected, so the harness counts it as killed.
 */
export function mutantDeadlineMs(baselineMs: number): number {
  return Math.max(60_000, 5 * baselineMs);
}

/**
 * SIGKILLs the child's whole process group. Vitest's workers are grandchildren of `bunx`, and a
 * killed parent alone leaves them running with the output pipes open.
 */
export function killGroup(proc: ChildProcess): void {
  if (proc.pid === undefined) return;
  try {
    process.kill(-proc.pid, "SIGKILL");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
  }
}

type SpawnOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** Stream the child's output instead of keeping its tail. */
  verbose: boolean;
  /** Kill the run's process group this long after it starts. */
  deadlineMs?: number;
  /** Told the running child, then `null` once it has gone, so a signal handler can kill it. */
  track?: (proc: ChildProcess | null) => void;
};

/**
 * Runs `bin` in a process group of its own and resolves once every process holding its output
 * has gone. The result's `tail` is the last 25 lines of its output.
 */
export function spawnRecording(
  bin: string,
  args: string[],
  { cwd, env, verbose, deadlineMs, track }: SpawnOptions,
): Promise<SuiteResult> {
  const started = Date.now();
  return new Promise((resolvePromise) => {
    const proc = spawn(bin, args, {
      cwd,
      env,
      stdio: verbose ? "inherit" : ["ignore", "pipe", "pipe"],
      detached: true,
    });
    track?.(proc);
    let timedOut = false;
    const deadline =
      deadlineMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            killGroup(proc);
          }, deadlineMs);
    let out = "";
    proc.stdout?.on("data", (d: Buffer) => {
      out += d.toString();
    });
    proc.stderr?.on("data", (d: Buffer) => {
      out += d.toString();
    });
    proc.on("close", (code) => {
      clearTimeout(deadline);
      track?.(null);
      resolvePromise({
        green: code === 0 && !timedOut,
        timedOut,
        ms: Date.now() - started,
        tail: out.split("\n").slice(-25).join("\n"),
      });
    });
  });
}
