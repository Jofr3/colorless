import { describe, expect, it, vi } from "vitest";
import { LazyScreen, type Screen } from "./lazyScreen";

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
});
