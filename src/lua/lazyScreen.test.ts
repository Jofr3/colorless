import { describe, expect, it, vi } from "vitest";
import { LazyScreen, loadFailureHandler, type Screen, TABLE_OFFLINE } from "./lazyScreen";

function recorder() {
  const seen: string[] = [];
  const screen: Screen = {
    command: (raw) => seen.push(`command ${raw}`),
    session: (status, id) => seen.push(`session ${status} ${id}`),
  };
  return { seen, screen };
}

describe("LazyScreen", () => {
  it("loads once and runs the commands sent meanwhile in order, after the latest session", async () => {
    const { seen, screen } = recorder();
    const load = vi.fn(async () => screen);
    const lazy = new LazyScreen(load, () => {});
    lazy.session("loading", "");
    const first = lazy.command("open");
    lazy.session("authenticated", "u1");
    lazy.command("menu-page");
    await first;
    lazy.command("close");
    expect(load).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([
      "session authenticated u1",
      "command open",
      "command menu-page",
      "command close",
    ]);
    lazy.session("anonymous", "");
    expect(seen.at(-1)).toBe("session anonymous ");
  });

  it("drops the queue when the load fails and tries again on the next command", async () => {
    const { seen, screen } = recorder();
    const failed = vi.fn();
    const load = vi
      .fn<() => Promise<Screen>>()
      .mockRejectedValueOnce(new Error("chunk"))
      .mockResolvedValue(screen);
    const lazy = new LazyScreen(load, failed);
    await lazy.command("open");
    expect(failed).toHaveBeenCalledTimes(1);
    await lazy.command("resume");
    expect(load).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(["command resume"]);
  });

  it("answers what it can without loading, and loads for the rest", async () => {
    const { seen, screen } = recorder();
    const load = vi.fn(async () => screen);
    const lazy = new LazyScreen(load, () => {}, { answer: (raw) => raw === "resume" });
    expect(lazy.command("resume")).toBe(true);
    expect(load).not.toHaveBeenCalled();
    await lazy.command("open");
    expect(load).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["command open"]);
  });

  it("warms the load without a command, and the next command finds it loaded", async () => {
    const { seen, screen } = recorder();
    const load = vi.fn(async () => screen);
    const lazy = new LazyScreen(load, () => {});
    lazy.session("authenticated", "u1");
    await lazy.warm();
    lazy.warm();
    expect(load).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["session authenticated u1"]);
    lazy.command("open");
    expect(seen.at(-1)).toBe("command open");
  });

  it("a warm-up that fails says nothing, and the next command tries again", async () => {
    const { seen, screen } = recorder();
    const failed = vi.fn();
    const load = vi
      .fn<() => Promise<Screen>>()
      .mockRejectedValueOnce(new Error("chunk"))
      .mockResolvedValue(screen);
    const lazy = new LazyScreen(load, failed);
    await lazy.warm();
    expect(failed).not.toHaveBeenCalled();
    await lazy.command("open");
    expect(load).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(["command open"]);
  });

  it("a command waiting on a failing warm-up reports the failure", async () => {
    const failed = vi.fn();
    const lazy = new LazyScreen(() => Promise.reject(new Error("chunk")), failed);
    const warming = lazy.warm();
    const open = lazy.command("open");
    await Promise.all([warming, open]);
    expect(failed).toHaveBeenCalledTimes(1);
  });
});

describe("a screen chunk that will not load", () => {
  const deps = (offline: boolean) => ({
    offline: () => offline,
    reload: vi.fn(),
    notice: vi.fn(),
    report: vi.fn(),
  });
  it("reloads onto the new build while the browser is online", () => {
    const d = deps(false);
    loadFailureHandler(d)(new Error("chunk"));
    expect(d.reload).toHaveBeenCalledTimes(1);
    expect(d.notice).not.toHaveBeenCalled();
    expect(d.report).toHaveBeenCalledTimes(1);
  });
  it("offline, keeps the page and tells Lua to say so, instead of reloading onto an error page", () => {
    const d = deps(true);
    loadFailureHandler(d)(new Error("chunk"));
    expect(d.reload).not.toHaveBeenCalled();
    expect(d.notice).toHaveBeenCalledWith(TABLE_OFFLINE);
  });
});
