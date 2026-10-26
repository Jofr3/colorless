import { describe, expect, it } from "vitest";
import { epochGuard, sessionUser } from "./epochGuard";

describe("epochGuard", () => {
  it("keeps a generation live until the next one starts", () => {
    const guard = epochGuard();
    const first = guard.next();
    expect(first()).toBe(true);
    const second = guard.next();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it("checks the running generation without starting one", () => {
    const guard = epochGuard();
    const running = guard.next();
    const current = guard.current();
    expect(running()).toBe(true);
    expect(current()).toBe(true);
    guard.next();
    expect(current()).toBe(false);
  });

  it("invalidates every earlier check", () => {
    const guard = epochGuard();
    const started = guard.next();
    const current = guard.current();
    guard.invalidate();
    expect(started()).toBe(false);
    expect(current()).toBe(false);
    expect(guard.current()()).toBe(true);
  });

  it("keeps separate guards apart", () => {
    const a = epochGuard();
    const b = epochGuard();
    const check = a.next();
    b.next();
    b.invalidate();
    expect(check()).toBe(true);
  });
});

describe("sessionUser", () => {
  it("waits while the session loads", () => {
    expect(sessionUser("loading", "u1", "")).toBeUndefined();
    expect(sessionUser("loading", "", "u1")).toBeUndefined();
  });

  it("leaves the same signed-in user alone", () => {
    expect(sessionUser("authenticated", "u1", "u1")).toBeUndefined();
  });

  it("moves to a new user, or to nobody once signed out or unreachable", () => {
    expect(sessionUser("authenticated", "u2", "u1")).toBe("u2");
    expect(sessionUser("anonymous", "", "u1")).toBe("");
    expect(sessionUser("error", "", "u1")).toBe("");
    expect(sessionUser("anonymous", "", "")).toBe("");
  });
});
