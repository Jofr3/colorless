// frontend/lua/balatroSource.mjs: where the Lua build, its tools and the Lua tests find Balatro's
// source tree, from the main checkout and from a git worktree alike.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mainCheckout as scriptsMainCheckout, repoPath } from "./lib/repo";

type Source = { dir: string; from: string };
/** The module's exports, as this suite (a .ts file without allowJs) types them. */
type BalatroSource = {
  mainCheckout: (cwd: string) => string | undefined;
  balatroSource: (root: string, env?: Record<string, string | undefined>) => Source;
  sourceProblem: (source: Source, needs: { loveJs: boolean }) => string | undefined;
};
const { mainCheckout, balatroSource, sourceProblem }: BalatroSource = await import(
  repoPath("frontend/lua/balatroSource.mjs")
);

let base: string;
let main: string;
let worktree: string;
let outside: string;
beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "colorless-source-")));
  main = join(base, "projects/colorless");
  worktree = join(main, ".claude/worktrees/agent");
  outside = join(base, "plain/colorless");
  mkdirSync(main, { recursive: true });
  mkdirSync(outside, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd: main,
      stdio: "ignore",
    });
  git("init", "-q");
  git("commit", "-q", "--allow-empty", "-m", "root");
  git("worktree", "add", "-q", worktree);
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("balatroSource", () => {
  it("finds the main checkout from a worktree", () => {
    expect(mainCheckout(worktree)).toBe(main);
    expect(mainCheckout(main)).toBe(main);
  });

  it("is undefined outside git", () => {
    expect(mainCheckout(outside)).toBeUndefined();
  });

  it("agrees with scripts/lib/repo.ts's lookup", () => {
    for (const dir of [worktree, main, outside, repoPath(".")])
      expect(scriptsMainCheckout(dir)).toBe(mainCheckout(dir));
  });

  it("defaults to balatro-source beside the main checkout, from a worktree too", () => {
    const expected = join(base, "projects/balatro-source");
    expect(balatroSource(worktree, {}).dir).toBe(expected);
    expect(balatroSource(main, {}).dir).toBe(expected);
  });

  it("falls back to beside the checkout outside git", () => {
    expect(balatroSource(outside, {})).toEqual({
      dir: join(base, "plain/balatro-source"),
      from: "beside this checkout",
    });
  });

  it("lets BALATRO_SOURCE win, resolved to an absolute path", () => {
    expect(balatroSource(worktree, { BALATRO_SOURCE: "/srv/balatro" })).toEqual({
      dir: "/srv/balatro",
      from: "BALATRO_SOURCE",
    });
    expect(balatroSource(worktree, { BALATRO_SOURCE: "" }).from).toBe("beside the main checkout");
  });
});

describe("sourceProblem", () => {
  it("names the directory tried and how it was chosen when there is no tree", () => {
    const problem = sourceProblem(
      { dir: join(base, "none"), from: "BALATRO_SOURCE" },
      {
        loveJs: false,
      },
    );
    expect(problem).toContain(`No Balatro source at ${join(base, "none")} (BALATRO_SOURCE)`);
  });

  it("asks for love.js only when the build needs it", () => {
    const dir = join(base, "tree");
    mkdirSync(join(dir, "engine"), { recursive: true });
    writeFileSync(join(dir, "engine/ui.lua"), "");
    const tree = { dir, from: "BALATRO_SOURCE" };
    expect(sourceProblem(tree, { loveJs: false })).toBeUndefined();
    expect(sourceProblem(tree, { loveJs: true })).toContain("npm install love.js@11.4.1");
    mkdirSync(join(dir, "node_modules/love.js"), { recursive: true });
    writeFileSync(join(dir, "node_modules/love.js/index.js"), "");
    expect(sourceProblem(tree, { loveJs: true })).toBeUndefined();
  });
});
