import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deadline } from "./deadline";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("deadline", () => {
  it("passes on work that finishes in time", async () => {
    const limit = deadline(100);
    expect(await limit.within(Promise.resolve("done"))).toBe("done");
    limit.clear();
    await vi.advanceTimersByTimeAsync(100);
    expect(limit.signal.aborted).toBe(false);
  });

  it("rejects work still pending when the time is up, and aborts the signal", async () => {
    const limit = deadline(100);
    const outcome = limit.within(new Promise(() => {})).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(99);
    expect(limit.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(limit.signal.aborted).toBe(true);
    expect(await outcome).toMatchObject({ name: "TimeoutError" });
    // Later work under a spent deadline fails at once.
    await expect(limit.within(new Promise(() => {}))).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });
});
