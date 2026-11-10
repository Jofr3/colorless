import { afterEach, describe, expect, it, vi } from "vitest";
import {
  logErrorThrottled,
  logErrorThrottledBy,
  logEvent,
  logEventThrottled,
  logEventThrottledBy,
  logInfo,
  resetLogThrottle,
} from "./log";

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

  it("writes success and audit lines at info level", () => {
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logInfo("d1", "sweep", { sessions: 3 });
    expect(info).toHaveBeenCalledWith('{"evt":"d1","kind":"sweep","sessions":3}');
    expect(warn).not.toHaveBeenCalled();
  });

  it("throttles each `by` value of one kind on its own", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logEventThrottledBy("endTurn", "lobby", "action_threw", { type: "endTurn" }, 1000, 0);
    logEventThrottledBy("endTurn", "lobby", "action_threw", { type: "endTurn" }, 1000, 10);
    logEventThrottledBy("attack", "lobby", "action_threw", { type: "attack" }, 1000, 20);
    // The plain throttle of the kind is a third, separate one.
    logEventThrottled("lobby", "action_threw", {}, 1000, 30);
    logEventThrottledBy("endTurn", "lobby", "action_threw", { type: "endTurn" }, 1000, 1500);
    expect(warn.mock.calls.map(([line]) => line)).toEqual([
      '{"evt":"lobby","kind":"action_threw","type":"endTurn"}',
      '{"evt":"lobby","kind":"action_threw","type":"attack"}',
      '{"evt":"lobby","kind":"action_threw"}',
      '{"evt":"lobby","kind":"action_threw","type":"endTurn","suppressed":1}',
    ]);
  });

  it("throttles error-level lines the same way", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logErrorThrottled("auth", "pepper_missing", {}, 1000, 0);
    logErrorThrottled("auth", "pepper_missing", {}, 1000, 10);
    logErrorThrottled("auth", "pepper_missing", {}, 1000, 2000);
    expect(error.mock.calls.map(([line]) => line)).toEqual([
      '{"evt":"auth","kind":"pepper_missing"}',
      '{"evt":"auth","kind":"pepper_missing","suppressed":1}',
    ]);
  });

  it("throttles each `by` value of an error-level kind on its own", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logErrorThrottledBy("endTurn", "lobby", "action_threw", { type: "endTurn" }, 1000, 0);
    logErrorThrottledBy("endTurn", "lobby", "action_threw", { type: "endTurn" }, 1000, 10);
    logErrorThrottledBy("attack", "lobby", "action_threw", { type: "attack" }, 1000, 20);
    logErrorThrottled("lobby", "action_threw", {}, 1000, 30);
    logErrorThrottledBy("endTurn", "lobby", "action_threw", { type: "endTurn" }, 1000, 1500);
    expect(error.mock.calls.map(([line]) => line)).toEqual([
      '{"evt":"lobby","kind":"action_threw","type":"endTurn"}',
      '{"evt":"lobby","kind":"action_threw","type":"attack"}',
      '{"evt":"lobby","kind":"action_threw"}',
      '{"evt":"lobby","kind":"action_threw","type":"endTurn","suppressed":1}',
    ]);
    expect(warn).not.toHaveBeenCalled();
  });
});
