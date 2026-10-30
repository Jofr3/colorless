import { afterEach, describe, expect, it, vi } from "vitest";
import { IDLE_FALLBACK_MS, IDLE_TIMEOUT_MS, whenIdle } from "./idle";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("whenIdle", () => {
  it("runs the task in the browser's next idle period, within a deadline", () => {
    const queued: (() => void)[] = [];
    const requestIdleCallback = vi.fn((callback: () => void) => {
      queued.push(callback);
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    const task = vi.fn();
    whenIdle(task);
    expect(task).not.toHaveBeenCalled();
    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), {
      timeout: IDLE_TIMEOUT_MS,
    });
    queued[0]?.();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("falls back to a short timer where there is no requestIdleCallback (Safari)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    const task = vi.fn();
    whenIdle(task);
    expect(task).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(IDLE_FALLBACK_MS - 1);
    expect(task).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
