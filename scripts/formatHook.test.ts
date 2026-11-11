import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkoutOf, editedFile, formatEdited } from "./format-hook";
import { REPO_ROOT, repoPath } from "./lib/repo";

const UGLY = "export const a = {b:1,   c:2}\n";

describe(".claude/settings.json", () => {
  const ignored = (path: string) =>
    spawnSync("git", ["check-ignore", "-q", path], { cwd: REPO_ROOT }).status === 0;

  it("is tracked and runs this hook, while the rest of .claude/ stays ignored", () => {
    expect(ignored(".claude/settings.json")).toBe(false);
    expect(ignored(".claude/settings.local.json")).toBe(true);
    expect(ignored(".claude/worktrees/x/a.ts")).toBe(true);
    expect(readFileSync(repoPath(".claude/settings.json"), "utf8")).toContain(
      "scripts/format-hook.ts",
    );
  });
});

describe("editedFile", () => {
  it("reads tool_input.file_path", () => {
    expect(editedFile(JSON.stringify({ tool_input: { file_path: "/r/src/a.ts" } }))).toBe(
      "/r/src/a.ts",
    );
  });

  it("is null for bad JSON, no path, or a relative path", () => {
    expect(editedFile("not json")).toBeNull();
    expect(editedFile(JSON.stringify({ file_path: "/r/a.ts" }))).toBeNull();
    expect(editedFile(JSON.stringify({ tool_input: { file_path: "src/a.ts" } }))).toBeNull();
  });
});

describe("checkoutOf", () => {
  const dirs = new Set([
    "/r/.git",
    "/r/biome.json",
    "/r/wt/.git",
    "/r/wt/biome.json",
    "/r/tmp/probe/biome.json",
  ]);
  const exists = (path: string) => dirs.has(path);

  it("picks the nearest ancestor with .git and biome.json", () => {
    expect(checkoutOf("/r/src/lib/a.ts", "/r", exists)).toBe("/r");
    expect(checkoutOf("/r/wt/src/a.ts", "/r", exists)).toBe("/r/wt");
    expect(checkoutOf("/r/tmp/probe/src/a.ts", "/r", exists)).toBe("/r");
  });

  it("is null outside the repo, including a sibling that shares its prefix", () => {
    expect(checkoutOf("/elsewhere/a.ts", "/r", exists)).toBeNull();
    expect(checkoutOf("/rx/a.ts", "/r", (p) => p.startsWith("/rx/") || exists(p))).toBeNull();
  });
});

describe("formatEdited", () => {
  const base = mkdtempSync(join(tmpdir(), "format-hook-"));
  const root = join(base, "colorless");
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  const config = readFileSync(repoPath("biome.json"), "utf8");
  const checkout = (dir: string, biomeJson = config) => {
    mkdirSync(join(dir, ".git"), { recursive: true });
    writeFileSync(join(dir, "biome.json"), biomeJson);
    writeFileSync(join(dir, ".gitignore"), "tmp/\n.claude/\n");
  };
  const ugly = (path: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, UGLY);
    return path;
  };
  const run = (path: string) => {
    formatEdited(JSON.stringify({ tool_input: { file_path: path } }), root);
    return readFileSync(path, "utf8");
  };

  checkout(root);

  it("formats a source file in the repo", () => {
    expect(run(ugly(join(root, "src/a.ts")))).toBe("export const a = { b: 1, c: 2 };\n");
  });

  it("formats a worktree's file with the worktree's own config", () => {
    const wt = join(root, ".claude/worktrees/one");
    checkout(wt, config.replace('"quoteStyle": "double"', '"quoteStyle": "single"'));
    const file = join(wt, "src/b.ts");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, 'export const b = "x"\n');
    expect(run(file)).toBe("export const b = 'x';\n");
  });

  it("leaves ignored files, a probe copy without .git, Markdown and other repos alone", () => {
    expect(run(ugly(join(root, "tmp/x.ts")))).toBe(UGLY);
    const probe = join(root, "tmp/probe");
    mkdirSync(probe, { recursive: true });
    writeFileSync(join(probe, "biome.json"), config);
    expect(run(ugly(join(probe, "src/c.ts")))).toBe(UGLY);
    const md = join(root, "src/notes.md");
    writeFileSync(md, "#  Title\n");
    expect(run(md)).toBe("#  Title\n");
    const sibling = join(base, "colorless-old");
    checkout(sibling);
    expect(run(ugly(join(sibling, "src/d.ts")))).toBe(UGLY);
  });
});
