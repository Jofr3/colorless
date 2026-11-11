import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { GEN_STEPS, type GenStep, plannedSteps, regenerate } from "./gen";
import { repoPath } from "./lib/repo";

describe("plannedSteps", () => {
  it("runs every generator, in order, with a local catalog", () => {
    expect(plannedSteps(true)).toEqual({ run: [...GEN_STEPS], skipped: [] });
  });

  it("skips exactly the catalog generators without one", () => {
    const { run, skipped } = plannedSteps(false);
    expect(skipped.map((step) => step.writes)).toEqual([
      "reprint aliases",
      "catalog manifest",
      "census corpora",
    ]);
    expect(run.map((step) => step.writes)).toEqual([
      "Lua constants",
      "decision index",
      "Worker types",
    ]);
  });

  it("names scripts that exist and the api's types script", () => {
    for (const { check, write } of GEN_STEPS) {
      for (const arg of [...check, ...write].filter((a) => a.startsWith("scripts/"))) {
        expect(existsSync(repoPath(arg)), arg).toBe(true);
      }
    }
    const api = JSON.parse(readFileSync(repoPath("apps/api/package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(api.scripts.types).toBeDefined();
  });
});

describe("regenerate", () => {
  const step = (writes: string): GenStep => ({
    writes,
    check: [writes, "--check"],
    write: [writes],
    catalog: false,
  });

  it("rewrites only the steps whose check fails, and reports a failed rewrite", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const ran: string[] = [];
    const run = (argv: readonly string[]) => {
      ran.push(argv.join(" "));
      return argv.join(" ") === "current --check";
    };
    expect(regenerate([step("current"), step("stale")], run)).toEqual(["stale"]);
    expect(ran).toEqual(["current --check", "stale --check", "stale"]);
  });
});
