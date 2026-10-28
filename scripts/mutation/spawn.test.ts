import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../lib/repo";
import { mutantDeadlineMs, spawnRecording } from "./spawn";

const run = (script: string, deadlineMs?: number) =>
  spawnRecording("sh", ["-c", script], {
    cwd: REPO_ROOT,
    env: process.env,
    verbose: false,
    deadlineMs,
  });

describe("mutantDeadlineMs", () => {
  it("is five baselines, never under a minute", () => {
    expect(mutantDeadlineMs(0)).toBe(60_000);
    expect(mutantDeadlineMs(11_000)).toBe(60_000);
    expect(mutantDeadlineMs(30_000)).toBe(150_000);
  });
});

describe("spawnRecording", () => {
  it("reports a run's exit code and output", async () => {
    expect(await run("echo green")).toMatchObject({
      green: true,
      timedOut: false,
      tail: "green\n",
    });
    expect(await run("exit 1", 10_000)).toMatchObject({ green: false, timedOut: false });
  });

  // The grandchild holds the output pipe, as vitest's workers do under `bunx`; killing only the
  // shell would leave the run waiting for it.
  it("kills a hung run and its children at the deadline, and never calls it green", async () => {
    const result = await run("sleep 30 & wait", 300);
    expect(result).toMatchObject({ green: false, timedOut: true });
    expect(result.ms).toBeLessThan(5_000);
  });
});
