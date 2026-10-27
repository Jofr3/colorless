import { afterEach, describe, expect, it, vi } from "vitest";
import { logEvent, logEventThrottled, resetLogThrottle } from "./log";

afterEach(() => {
  vi.restoreAllMocks();
  resetLogThrottle();
});

describe("logEvent", () => {
  it("writes one JSON line with evt and kind first", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logEvent("auth", "rate_limited", { scope: "login" });
    expect(warn).toHaveBeenCalledWith('{"evt":"auth","kind":"rate_limited","scope":"login"}');
  });

  it("throttles per evt and kind, then reports what it suppressed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logEventThrottled("kv", "put_failed", {}, 1000, 0);
    logEventThrottled("kv", "put_failed", {}, 1000, 10);
    logEventThrottled("kv", "put_failed", {}, 1000, 20);
    logEventThrottled("kv", "get_failed", {}, 1000, 30);
    logEventThrottled("kv", "put_failed", {}, 1000, 1500);
    expect(warn.mock.calls.map(([line]) => line)).toEqual([
      '{"evt":"kv","kind":"put_failed"}',
      '{"evt":"kv","kind":"get_failed"}',
      '{"evt":"kv","kind":"put_failed","suppressed":2}',
    ]);
  });
});
