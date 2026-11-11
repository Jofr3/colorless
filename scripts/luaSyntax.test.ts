// frontend/lua/luaSyntax.mjs: build:lua refuses a Lua syntax error with luac's file:line, and only
// trusts a 5.1 luac. Stand-in luac scripts keep the suite independent of the Lua on this machine.

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repoPath } from "./lib/repo";

/** The module's exports, as this suite (a .ts file without allowJs) types them. */
type LuaSyntax = {
  luacCandidates: (root: string, main: string | undefined) => string[];
  findLuac: (candidates: string[]) => string | undefined;
  luaSyntaxError: (luac: string, cwd: string, files: string[]) => string | undefined;
};
const { luacCandidates, findLuac, luaSyntaxError }: LuaSyntax = await import(
  repoPath("frontend/lua/luaSyntax.mjs")
);

let dir: string;
/** A stand-in luac: `-v` prints `version` (to stderr, as 5.1 does); `-p` fails on a file named bad.lua. */
function fakeLuac(name: string, version: string): string {
  const path = join(dir, name);
  writeFileSync(
    path,
    `#!/bin/sh
if [ "$1" = "-v" ]; then echo "${version}  Copyright (C) 1994-2012 Lua.org, PUC-Rio" >&2; exit 0; fi
shift
for f in "$@"; do
  if [ "$(basename "$f")" = bad.lua ]; then echo "$0: $f:3: '=' expected near 'x'" >&2; exit 1; fi
done
`,
  );
  chmodSync(path, 0o755);
  return path;
}
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "colorless-luac-"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("findLuac", () => {
  it("skips a luac that is not 5.1 and one that does not run", () => {
    const v52 = fakeLuac("luac52", "Lua 5.2.4");
    const v51 = fakeLuac("luac51", "Lua 5.1.5");
    expect(findLuac([join(dir, "missing"), v52, v51])).toBe(v51);
    expect(findLuac([v52])).toBeUndefined();
  });

  it("looks in this checkout's and the main checkout's nix link, between luac5.1 and luac", () => {
    expect(luacCandidates("/w", "/m")).toEqual([
      "luac5.1",
      "/w/node_modules/.cache/lua5.1/bin/luac",
      "/m/node_modules/.cache/lua5.1/bin/luac",
      "luac",
    ]);
    expect(luacCandidates("/m", "/m")).toEqual([
      "luac5.1",
      "/m/node_modules/.cache/lua5.1/bin/luac",
      "luac",
    ]);
  });
});

describe("luaSyntaxError", () => {
  it("passes files that parse", () => {
    expect(luaSyntaxError(fakeLuac("ok", "Lua 5.1.5"), dir, ["main.lua", "ui/a.lua"])).toBe(
      undefined,
    );
  });

  it("returns the first error as file:line, without luac's own name", () => {
    mkdirSync(join(dir, "ui"), { recursive: true });
    const luac = fakeLuac("luac-p", "Lua 5.1.5");
    expect(luaSyntaxError(luac, dir, ["main.lua", "ui/bad.lua"])).toBe(
      "ui/bad.lua:3: '=' expected near 'x'",
    );
  });
});
