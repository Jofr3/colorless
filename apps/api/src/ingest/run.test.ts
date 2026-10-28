import { describe, expect, it } from "vitest";
import {
  createRowsTally,
  exitCode,
  mapBounded,
  rerunCommand,
  rowsWrittenOf,
  shouldStampEpoch,
} from "./run";

/** A promise with its resolve and reject exposed, so a test decides when each task settles. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: Error) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("mapBounded", () => {
  it("keeps input order whatever order the tasks finish in", async () => {
    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
    const run = mapBounded([0, 1, 2], 3, (i) => (gates[i] as (typeof gates)[number]).promise);
    gates[2]?.resolve("c");
    gates[0]?.resolve("a");
    gates[1]?.resolve("b");
    expect(await run).toEqual(["a", "b", "c"]);
  });

  it("never runs more than `limit` tasks at once", async () => {
    let running = 0;
    let peak = 0;
    await mapBounded([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      running -= 1;
      return n;
    });
    expect(peak).toBe(3);
  });

  it("rejects with the first failure and claims no item after it", async () => {
    const started: number[] = [];
    const gates = new Map<number, ReturnType<typeof deferred<number>>>();
    const run = mapBounded([0, 1, 2, 3, 4, 5], 2, (n) => {
      started.push(n);
      const gate = deferred<number>();
      gates.set(n, gate);
      return gate.promise;
    });
    expect(started).toEqual([0, 1]);
    gates.get(0)?.reject(new Error("HTTP 503 for /cards/x"));
    gates.get(1)?.resolve(1);
    await expect(run).rejects.toThrow("HTTP 503 for /cards/x");
    await tick();
    expect(started).toEqual([0, 1]);
  });

  it("handles an empty list and a limit above its length", async () => {
    expect(await mapBounded([], 4, async (n: number) => n)).toEqual([]);
    expect(await mapBounded([1], 4, async (n) => n * 2)).toEqual([2]);
  });
});

describe("rowsWrittenOf", () => {
  it("sums rows_written over every statement wrangler printed", () => {
    const stdout = JSON.stringify([
      { results: [], meta: { rows_written: 3 } },
      { results: [], meta: { rows_written: 0 } },
      { results: [], meta: { rows_written: 250 } },
    ]);
    expect(rowsWrittenOf(stdout)).toBe(253);
  });

  it("is unknown when any statement lacks a count, or the output is not JSON", () => {
    expect(rowsWrittenOf(JSON.stringify([{ meta: { rows_written: 1 } }, { meta: {} }]))).toBeNull();
    expect(rowsWrittenOf("🌀 Executing on local database")).toBeNull();
  });
});

describe("createRowsTally and shouldStampEpoch", () => {
  const wrote = (n: number) => JSON.stringify([{ meta: { rows_written: n } }]);

  it("a remote run that wrote nothing keeps the epoch", () => {
    const tally = createRowsTally(true);
    expect(tally.applied(wrote(0))).toBe(0);
    tally.applied(wrote(0));
    expect(tally.total).toBe(0);
    expect(shouldStampEpoch(tally.total, false)).toBe(false);
  });

  it("a remote run that wrote rows stamps", () => {
    const tally = createRowsTally(true);
    tally.applied(wrote(0));
    tally.applied(wrote(12));
    expect(tally.total).toBe(12);
    expect(shouldStampEpoch(tally.total, false)).toBe(true);
  });

  it("an apply that exited non-zero makes the count unknown, so the run stamps", () => {
    // A remote import can commit and still exit non-zero; counting it as 0 rows would skip a
    // stamp the committed rows need.
    const tally = createRowsTally(true);
    tally.applied(wrote(0));
    tally.failed();
    tally.applied(wrote(0));
    expect(tally.total).toBeNull();
    expect(shouldStampEpoch(tally.total, false)).toBe(true);
  });

  it("an apply that printed no count makes the total unknown for good", () => {
    const tally = createRowsTally(true);
    expect(tally.applied("not json")).toBeNull();
    tally.applied(wrote(5));
    expect(tally.total).toBeNull();
  });

  it("a local run never learns a count, so it always stamps", () => {
    const tally = createRowsTally(false);
    tally.applied(wrote(7));
    expect(tally.total).toBeNull();
    expect(shouldStampEpoch(tally.total, false)).toBe(true);
  });

  it("a dry run reports the stamp it would make", () => {
    expect(shouldStampEpoch(0, true)).toBe(true);
  });
});

describe("exitCode", () => {
  const clean = { failedSets: [], weakless: [], epochStamped: true, postPassFailed: false };

  it("is 0 only when nothing needs a person", () => {
    expect(exitCode(clean)).toBe(0);
    expect(exitCode({ ...clean, failedSets: ["sv01"] })).toBe(1);
    expect(exitCode({ ...clean, weakless: ["sv01-001"] })).toBe(1);
    expect(exitCode({ ...clean, epochStamped: false })).toBe(1);
    expect(exitCode({ ...clean, postPassFailed: true })).toBe(1);
  });
});

describe("rerunCommand", () => {
  it("names only the failed sets, with the same target and transport", () => {
    expect(rerunCommand(["sv01", "sv03.5"], { remote: true })).toBe(
      "bun scripts/ingest.ts --sets sv01,sv03.5 --remote",
    );
    expect(rerunCommand(["me01"], { remote: false, transport: "sdk" })).toBe(
      "bun scripts/ingest.ts --sets me01 --transport sdk",
    );
  });
});
