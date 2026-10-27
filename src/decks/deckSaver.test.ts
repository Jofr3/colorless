import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api";
import {
  createDeckSaver,
  MAX_RATE_LIMIT_RETRIES,
  rateLimitRetryDelay,
  type SaveStatus,
} from "./deckSaver";

// The saver is the builder's whole persistence contract (debounce, serialize,
// latest-wins, no-op skip, no auto-retry but a rate-limited one), so it gets exercised directly with
// fake timers and a hand-controlled save promise.

type Snap = { v: number };

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function statusRecorder() {
  const statuses: SaveStatus[] = [];
  const errors: unknown[] = [];
  return {
    statuses,
    errors,
    onStatus: (status: SaveStatus, error?: unknown) => {
      statuses.push(status);
      if (error !== undefined) errors.push(error);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createDeckSaver", () => {
  it("debounces a burst of edits into one save of the latest snapshot", async () => {
    const save = vi.fn(async (_: Snap) => {});
    const saver = createDeckSaver<Snap>({ save, delay: 600 });

    saver.schedule({ v: 1 });
    await vi.advanceTimersByTimeAsync(300);
    saver.schedule({ v: 2 });
    await vi.advanceTimersByTimeAsync(599);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ v: 2 });
  });

  it("skips snapshots identical to what the server already holds", async () => {
    const save = vi.fn(async (_: Snap) => {});
    const recorder = statusRecorder();
    const saver = createDeckSaver<Snap>({
      save,
      delay: 600,
      initial: { v: 1 },
      onStatus: recorder.onStatus,
    });

    // The mount-time schedule of the just-loaded state is a no-op…
    saver.schedule({ v: 1 });
    await vi.advanceTimersByTimeAsync(5_000);
    // …and so is an edit reverted inside the debounce window.
    saver.schedule({ v: 2 });
    await vi.advanceTimersByTimeAsync(300);
    saver.schedule({ v: 1 });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(save).not.toHaveBeenCalled();
    expect(recorder.statuses).toEqual([]);
  });

  it("serializes concurrent saves — one follow-up with the latest snapshot", async () => {
    const first = deferred();
    const save = vi
      .fn<(snapshot: Snap) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const recorder = statusRecorder();
    const saver = createDeckSaver<Snap>({ save, delay: 600, onStatus: recorder.onStatus });

    saver.schedule({ v: 1 });
    await vi.advanceTimersByTimeAsync(600);
    expect(save).toHaveBeenCalledTimes(1);

    // Two edits while the first save is in flight — they coalesce into ONE
    // follow-up carrying the latest state, fired only after the flight lands.
    saver.schedule({ v: 2 });
    saver.schedule({ v: 3 });
    await vi.advanceTimersByTimeAsync(600);
    expect(save).toHaveBeenCalledTimes(1);

    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ v: 3 });
    expect(recorder.statuses).toEqual(["saving", "saving", "saved"]);
  });

  it("reports a failure, keeps the snapshot, and retries on flush — never on its own", async () => {
    const boom = new Error("500");
    const save = vi
      .fn<(snapshot: Snap) => Promise<void>>()
      .mockRejectedValueOnce(boom)
      .mockResolvedValue(undefined);
    const recorder = statusRecorder();
    const saver = createDeckSaver<Snap>({ save, delay: 600, onStatus: recorder.onStatus });

    saver.schedule({ v: 1 });
    await vi.advanceTimersByTimeAsync(600);
    expect(recorder.statuses).toEqual(["saving", "failed"]);
    expect(recorder.errors).toEqual([boom]);

    // No auto-retry (a persistent 400 must not hot-loop)…
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).toHaveBeenCalledTimes(1);

    // …but the dirty snapshot is still there for the leave/close flush.
    saver.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ v: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(recorder.statuses).toEqual(["saving", "failed", "saving", "saved"]);
  });

  it("flush fires the pending save immediately and is a no-op when clean", async () => {
    const save = vi.fn(async (_: Snap) => {});
    const saver = createDeckSaver<Snap>({ save, delay: 600, initial: { v: 1 } });

    saver.flush(); // clean — nothing to do
    expect(save).not.toHaveBeenCalled();

    saver.schedule({ v: 2 });
    saver.flush(); // dirty — no waiting out the debounce
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ v: 2 });

    // The debounce timer was consumed by the flush — no second save later.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("still saves a snapshot flushed while a flight was up, even across dispose", async () => {
    const first = deferred();
    const save = vi
      .fn<(snapshot: Snap) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const recorder = statusRecorder();
    const saver = createDeckSaver<Snap>({ save, delay: 600, onStatus: recorder.onStatus });

    saver.schedule({ v: 1 });
    await vi.advanceTimersByTimeAsync(600);
    expect(save).toHaveBeenCalledTimes(1); // save A in flight

    // Edit B lands, then the saver is torn down: flush() can't fire past the
    // in-flight A, and dispose() follows immediately.
    saver.schedule({ v: 2 });
    saver.flush();
    saver.dispose();
    expect(save).toHaveBeenCalledTimes(1);

    // A settles → B still goes out, exactly once — dispose only silenced the
    // callbacks, it must not drop the flushed latest snapshot.
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ v: 2 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(recorder.statuses).toEqual(["saving"]); // nothing after dispose
  });

  it("dispose cancels the pending save and silences callbacks", async () => {
    const save = vi.fn(async (_: Snap) => {});
    const recorder = statusRecorder();
    const saver = createDeckSaver<Snap>({ save, delay: 600, onStatus: recorder.onStatus });

    saver.schedule({ v: 1 });
    saver.dispose();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(save).not.toHaveBeenCalled();
    expect(recorder.statuses).toEqual([]);
  });
});

describe("a rate-limited save", () => {
  const limited = (retryAfterSeconds?: number) =>
    new ApiError(429, { error: "too many requests" }, retryAfterSeconds);

  it("waits the Retry-After and sends the same edits again, without reporting a failure", async () => {
    const save = vi.fn(async (_: Snap) => {});
    save.mockRejectedValueOnce(limited(3));
    const recorder = statusRecorder();
    const saver = createDeckSaver<Snap>({ save, delay: 600, onStatus: recorder.onStatus });

    saver.schedule({ v: 1 });
    await vi.advanceTimersByTimeAsync(600);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ v: 1 });
    expect(recorder.statuses).toEqual(["saving", "saving", "saved"]);
  });

  it("folds edits made while waiting into the one retry, which a flush cannot hurry", async () => {
    const save = vi.fn(async (_: Snap) => {});
    save.mockRejectedValueOnce(limited(5));
    const saver = createDeckSaver<Snap>({ save, delay: 600 });

    saver.schedule({ v: 1 });
    await vi.advanceTimersByTimeAsync(600);
    saver.schedule({ v: 2 });
    await vi.advanceTimersByTimeAsync(600);
    saver.schedule({ v: 3 });
    saver.flush();
    // Refused at 600 ms, so the retry is due at 5,600 ms.
    await vi.advanceTimersByTimeAsync(4_399);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ v: 3 });
  });

  it("backs off without a Retry-After, then reports the failure and keeps the edits", async () => {
    const save = vi.fn(async (_: Snap): Promise<void> => {
      throw limited();
    });
    const recorder = statusRecorder();
    const saver = createDeckSaver<Snap>({ save, delay: 600, onStatus: recorder.onStatus });

    saver.schedule({ v: 1 });
    await vi.advanceTimersByTimeAsync(600);
    const waits = [2_000, 4_000, 8_000, 16_000, 32_000];
    expect(waits).toHaveLength(MAX_RATE_LIMIT_RETRIES);
    for (const [index, wait] of waits.entries()) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(save).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(save).toHaveBeenCalledTimes(index + 2);
    }
    expect(recorder.statuses.at(-1)).toBe("failed");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(save).toHaveBeenCalledTimes(MAX_RATE_LIMIT_RETRIES + 1);

    // The edits are still pending: Retry sends them.
    save.mockResolvedValueOnce(undefined);
    saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenLastCalledWith({ v: 1 });
    expect(recorder.statuses.at(-1)).toBe("saved");
  });

  it("is told apart from other failures, and its wait is bounded", () => {
    expect(rateLimitRetryDelay(new Error("offline"), 1)).toBeUndefined();
    expect(rateLimitRetryDelay(new ApiError(409, undefined), 1)).toBeUndefined();
    expect(rateLimitRetryDelay(limited(), 1)).toBe(2_000);
    expect(rateLimitRetryDelay(limited(0), 1)).toBe(1_000);
    expect(rateLimitRetryDelay(limited(3_600), 1)).toBe(60_000);
    expect(rateLimitRetryDelay(limited(5), MAX_RATE_LIMIT_RETRIES + 1)).toBeUndefined();
  });
});
