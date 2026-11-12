import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, RequestTimeoutError } from "../lib/api";
import {
  createDeckSaver,
  MAX_RATE_LIMIT_RETRIES,
  MAX_TRANSIENT_RETRIES,
  MIN_SAVE_SPACING_MS,
  outcomeUnknown,
  rateLimitRetryDelay,
  type SaveStatus,
  transientRetryDelay,
} from "./deckSaver";

// The saver is the builder's whole persistence contract (debounce, serialize,
// latest-wins, no-op skip, retries only after a 429 or a passing failure), so it gets exercised directly with
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
    const saver = createDeckSaver<Snap>({
      save,
      delay: 600,
      spacing: 0,
      onStatus: recorder.onStatus,
    });

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
    const boom = new ApiError(500, { error: "internal error" });
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
    const saver = createDeckSaver<Snap>({
      save,
      delay: 600,
      spacing: 0,
      onStatus: recorder.onStatus,
    });

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

  it("is idle only with nothing queued, backing off or in flight", async () => {
    const first = deferred();
    const save = vi
      .fn<(snapshot: Snap) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(new ApiError(429, undefined, 5));
    const saver = createDeckSaver<Snap>({ save, delay: 600 });
    expect(saver.idle()).toBe(true);
    saver.schedule({ v: 1 });
    expect(saver.idle()).toBe(false);
    saver.flush();
    expect(saver.idle()).toBe(false);
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(saver.idle()).toBe(true);
    saver.schedule({ v: 2 });
    saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(saver.idle()).toBe(false);
  });

  it("settles once a disposed saver's flight and the follow-up behind it have answered", async () => {
    const first = deferred();
    const second = deferred();
    const save = vi
      .fn<(snapshot: Snap) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const saver = createDeckSaver<Snap>({ save, delay: 600, spacing: 0 });
    await saver.settled();
    saver.schedule({ v: 1 });
    await vi.advanceTimersByTimeAsync(600);
    saver.schedule({ v: 2 });
    saver.flush();
    saver.dispose();
    const settled = vi.fn();
    void saver.settled().then(settled);
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(settled).not.toHaveBeenCalled();
    second.reject(new TypeError("Failed to fetch"));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("settles at dispose when only a debounced save was queued", async () => {
    const save = vi.fn(async (_: Snap) => {});
    const saver = createDeckSaver<Snap>({ save, delay: 600 });
    saver.schedule({ v: 1 });
    const settled = vi.fn();
    void saver.settled().then(settled);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).not.toHaveBeenCalled();
    saver.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
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

  it("saves a revert to the saved state made while a flight was up", async () => {
    const first = deferred();
    const save = vi
      .fn<(snapshot: Snap) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const saver = createDeckSaver<Snap>({ save, delay: 600, spacing: 0, initial: { v: 1 } });

    saver.schedule({ v: 2 });
    await vi.advanceTimersByTimeAsync(600);
    saver.schedule({ v: 1 });
    first.resolve();
    await vi.advanceTimersByTimeAsync(600);

    expect(save.mock.calls).toEqual([[{ v: 2 }], [{ v: 1 }]]);
  });

  it("sends nothing for a snapshot that converged onto the flight, and reports it saved", async () => {
    const first = deferred();
    const save = vi.fn<(snapshot: Snap) => Promise<void>>().mockReturnValueOnce(first.promise);
    const recorder = statusRecorder();
    const saver = createDeckSaver<Snap>({ save, delay: 600, onStatus: recorder.onStatus });

    saver.schedule({ v: 2 });
    await vi.advanceTimersByTimeAsync(600);
    saver.schedule({ v: 3 });
    saver.schedule({ v: 2 });
    first.resolve();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(save).toHaveBeenCalledTimes(1);
    expect(recorder.statuses).toEqual(["saving", "saved"]);
  });

  it("holds a follow-up until its debounce ends when the flight lands first", async () => {
    const first = deferred();
    const save = vi
      .fn<(snapshot: Snap) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const saver = createDeckSaver<Snap>({ save, delay: 600, spacing: 0 });

    saver.schedule({ v: 1 });
    await vi.advanceTimersByTimeAsync(600);
    saver.schedule({ v: 2 });
    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    saver.schedule({ v: 3 });
    await vi.advanceTimersByTimeAsync(599);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(save.mock.calls).toEqual([[{ v: 1 }], [{ v: 3 }]]);
  });

  it("still sends the newer snapshot once when a flight fails after dispose", async () => {
    const first = deferred();
    const save = vi
      .fn<(snapshot: Snap) => Promise<void>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const recorder = statusRecorder();
    const saver = createDeckSaver<Snap>({ save, delay: 600, onStatus: recorder.onStatus });

    saver.schedule({ v: 1 });
    await vi.advanceTimersByTimeAsync(600);
    saver.schedule({ v: 2 });
    saver.flush();
    saver.dispose();
    first.reject(new ApiError(400, undefined));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(save.mock.calls).toEqual([[{ v: 1 }], [{ v: 2 }]]);
    expect(recorder.statuses).toEqual(["saving"]);
  });

  it("sends nothing more after dispose when the failed flight was the latest edit", async () => {
    const save = vi.fn<(snapshot: Snap) => Promise<void>>().mockRejectedValue(new Error("offline"));
    const recorder = statusRecorder();
    const saver = createDeckSaver<Snap>({ save, delay: 600, onStatus: recorder.onStatus });

    saver.schedule({ v: 1 });
    saver.flush();
    saver.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    saver.schedule({ v: 2 });
    saver.flush();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(save).toHaveBeenCalledTimes(1);
    expect(recorder.statuses).toEqual(["saving"]);
  });
});

describe("the spacing between save starts", () => {
  /** How many saves a minute of edits `gap` ms apart sends, each save taking 150 ms. */
  async function savesPerMinute(gap: number, spacing?: number) {
    const save = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 150)));
    const saver = createDeckSaver<number>({ save, initial: 0, spacing });
    for (let t = 0, n = 1; t < 60_000; t += gap, n++) {
      saver.schedule(n);
      await vi.advanceTimersByTimeAsync(gap);
    }
    return save.mock.calls.length;
  }

  it("keeps steady editing at 60 saves a minute or fewer, the API's deck write limit", async () => {
    expect(MIN_SAVE_SPACING_MS).toBeGreaterThanOrEqual(1000);
    // Without it, an edit every 650 ms sends a save after each one.
    expect(await savesPerMinute(650, 0)).toBeGreaterThan(90);
    for (const gap of [650, 700, 800]) expect(await savesPerMinute(gap)).toBeLessThanOrEqual(60);
    expect(await savesPerMinute(1500)).toBe(40);
  });

  it("holds a save until a second after the last one started, edits coalescing meanwhile", async () => {
    const save = vi.fn(async (_: Snap) => {});
    const saver = createDeckSaver<Snap>({ save, delay: 600 });
    saver.schedule({ v: 1 });
    await vi.advanceTimersByTimeAsync(600);
    expect(save).toHaveBeenCalledTimes(1);
    saver.schedule({ v: 2 });
    await vi.advanceTimersByTimeAsync(200);
    saver.schedule({ v: 3 });
    await vi.advanceTimersByTimeAsync(799);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(save.mock.calls).toEqual([[{ v: 1 }], [{ v: 3 }]]);
  });

  it("measures the spacing on a monotonic clock, so a wall clock stepped back holds nothing", async () => {
    const save = vi.fn(async (_: Snap) => {});
    const saver = createDeckSaver<Snap>({ save, delay: 600 });
    saver.schedule({ v: 1 });
    await vi.advanceTimersByTimeAsync(600);
    vi.setSystemTime(Date.now() - 10 * 60_000);
    saver.schedule({ v: 2 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(save.mock.calls).toEqual([[{ v: 1 }], [{ v: 2 }]]);
    expect(saver.idle()).toBe(true);
  });

  it("does not hold a flush, which the page leaving or hiding sends", async () => {
    const save = vi.fn(async (_: Snap) => {});
    const saver = createDeckSaver<Snap>({ save, delay: 600 });
    saver.schedule({ v: 1 });
    await vi.advanceTimersByTimeAsync(600);
    saver.schedule({ v: 2 });
    saver.flush();
    expect(save.mock.calls).toEqual([[{ v: 1 }], [{ v: 2 }]]);
  });
});

describe("a save whose outcome is unknown", () => {
  it.each([
    ["the network failed", new TypeError("Failed to fetch")],
    ["a gateway answered 502", new ApiError(502, undefined)],
  ])("still sends an undo back to the saved state when %s", async (_, error) => {
    const sent: Snap[] = [];
    let fail = true;
    const save = vi.fn(async (snapshot: Snap) => {
      sent.push(snapshot);
      if (fail) {
        fail = false;
        throw error;
      }
    });
    const saver = createDeckSaver<Snap>({ save, delay: 600, initial: { v: 1 } });

    saver.schedule({ v: 2 });
    await vi.advanceTimersByTimeAsync(600);
    saver.schedule({ v: 1 });
    await vi.advanceTimersByTimeAsync(10_000);
    saver.flush();
    await vi.advanceTimersByTimeAsync(0);

    expect(sent).toEqual([{ v: 2 }, { v: 1 }]);
  });

  it("is told apart from a refusal, after which a revert has nothing to send", async () => {
    const save = vi
      .fn<(snapshot: Snap) => Promise<void>>()
      .mockRejectedValueOnce(new ApiError(400, { error: "invalid deck" }));
    const saver = createDeckSaver<Snap>({ save, delay: 600, initial: { v: 1 } });

    saver.schedule({ v: 2 });
    await vi.advanceTimersByTimeAsync(600);
    saver.schedule({ v: 1 });
    saver.flush();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(save).toHaveBeenCalledTimes(1);
    expect(outcomeUnknown(new TypeError("Failed to fetch"))).toBe(true);
    expect(outcomeUnknown(new ApiError(504, undefined))).toBe(true);
    expect(outcomeUnknown(new ApiError(409, undefined))).toBe(false);
    expect(outcomeUnknown(new ApiError(429, undefined))).toBe(false);
  });
});

describe("a save that failed in passing", () => {
  it.each([
    ["the network failed", new TypeError("Failed to fetch")],
    ["it timed out", new RequestTimeoutError(30_000)],
    ["a gateway answered 502", new ApiError(502, undefined)],
    ["a gateway answered 503", new ApiError(503, undefined)],
    ["a gateway answered 504", new ApiError(504, undefined)],
  ])("is sent again after 2, 4 and 8 s when %s, then reported", async (_, error) => {
    const save = vi.fn(async (_: Snap): Promise<void> => {
      throw error;
    });
    const recorder = statusRecorder();
    const saver = createDeckSaver<Snap>({ save, delay: 600, onStatus: recorder.onStatus });

    saver.schedule({ v: 1 });
    await vi.advanceTimersByTimeAsync(600);
    const waits = [2_000, 4_000, 8_000];
    expect(waits).toHaveLength(MAX_TRANSIENT_RETRIES);
    for (const [index, wait] of waits.entries()) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(save).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(save).toHaveBeenCalledTimes(index + 2);
    }
    expect(recorder.statuses).toEqual(["saving", "retrying", "retrying", "retrying", "failed"]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(save).toHaveBeenCalledTimes(MAX_TRANSIENT_RETRIES + 1);
  });

  it("lands on a retry without reporting a failure", async () => {
    const save = vi.fn(async (_: Snap) => {});
    save.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const recorder = statusRecorder();
    const saver = createDeckSaver<Snap>({ save, delay: 600, onStatus: recorder.onStatus });

    saver.schedule({ v: 1 });
    await vi.advanceTimersByTimeAsync(2_600);

    expect(save.mock.calls).toEqual([[{ v: 1 }], [{ v: 1 }]]);
    expect(recorder.statuses).toEqual(["saving", "retrying", "saved"]);
  });

  it("is told apart from the Worker's own failure and from a refusal", () => {
    expect(transientRetryDelay(new TypeError("Failed to fetch"), 1)).toBe(2_000);
    expect(transientRetryDelay(new ApiError(503, undefined), 3)).toBe(8_000);
    expect(transientRetryDelay(new ApiError(504, undefined), MAX_TRANSIENT_RETRIES + 1)).toBe(
      undefined,
    );
    expect(transientRetryDelay(new ApiError(500, undefined), 1)).toBeUndefined();
    expect(transientRetryDelay(new ApiError(400, undefined), 1)).toBeUndefined();
    expect(transientRetryDelay(new ApiError(409, undefined), 1)).toBeUndefined();
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
    expect(recorder.statuses).toEqual(["saving", "retrying", "saved"]);
  });

  it("waits out a Retry-After on a monotonic clock, whatever the wall clock does", async () => {
    const save = vi.fn(async (_: Snap) => {});
    save.mockRejectedValueOnce(limited(3));
    const saver = createDeckSaver<Snap>({ save, delay: 600 });
    saver.schedule({ v: 1 });
    await vi.advanceTimersByTimeAsync(600);
    vi.setSystemTime(Date.now() - 10 * 60_000);
    saver.schedule({ v: 2 });
    saver.flush();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ v: 2 });
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

  it("starts a fresh retry budget once a save gets through", async () => {
    const save = vi.fn(async (_: Snap) => {});
    for (let i = 0; i < MAX_RATE_LIMIT_RETRIES; i++) save.mockRejectedValueOnce(limited(1));
    save.mockResolvedValueOnce(undefined);
    for (let i = 0; i < MAX_RATE_LIMIT_RETRIES; i++) save.mockRejectedValueOnce(limited(1));
    const recorder = statusRecorder();
    const saver = createDeckSaver<Snap>({
      save,
      delay: 600,
      spacing: 0,
      onStatus: recorder.onStatus,
    });

    saver.schedule({ v: 1 });
    await vi.advanceTimersByTimeAsync(600 + MAX_RATE_LIMIT_RETRIES * 1_000);
    expect(recorder.statuses.at(-1)).toBe("saved");
    saver.schedule({ v: 2 });
    await vi.advanceTimersByTimeAsync(600 + MAX_RATE_LIMIT_RETRIES * 1_000);

    expect(save).toHaveBeenCalledTimes(2 * MAX_RATE_LIMIT_RETRIES + 2);
    expect(save).toHaveBeenLastCalledWith({ v: 2 });
    expect(recorder.statuses).not.toContain("failed");
  });

  it("keeps its whole retry budget after a failure that was reported", async () => {
    const save = vi.fn(async (_: Snap) => {});
    save.mockRejectedValueOnce(new ApiError(400, undefined));
    for (let i = 0; i < MAX_RATE_LIMIT_RETRIES; i++) save.mockRejectedValueOnce(limited(1));
    const recorder = statusRecorder();
    const saver = createDeckSaver<Snap>({ save, delay: 600, onStatus: recorder.onStatus });

    saver.schedule({ v: 1 });
    await vi.advanceTimersByTimeAsync(600);
    expect(recorder.statuses).toEqual(["saving", "failed"]);
    saver.flush();
    await vi.advanceTimersByTimeAsync(MAX_RATE_LIMIT_RETRIES * 1_000);

    expect(save).toHaveBeenCalledTimes(MAX_RATE_LIMIT_RETRIES + 2);
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
