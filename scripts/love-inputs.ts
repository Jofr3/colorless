#!/usr/bin/env bun
// The Lua build's two inputs from outside the repo (dependency audit VER10, decision 14): the
// love.js package installed in the Balatro source tree, and that tree's resources. love.js stays
// on 11.4.1 (LÖVE 11.4), its final npm release; `LOVE_JS` pins its version and the sha256 of the
// four files the build runs or copies, so a reinstall that changes any of them stops the build
// with the file named instead of shipping a different runtime. The source tree is recorded, not
// pinned: its git commit and whether its resources differ from it, beside the copied files'
// hashes (build.mjs writes both into public/love/asset-manifest.json).
//
//   bun scripts/love-inputs.ts <balatro-source>
//
// Exits 1 with the problems when love.js does not match; otherwise prints the inputs as JSON.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fail, isRecord, parseJson } from "./lib/cli";

/** The love.js release the build accepts, and the sha256 of the files it uses from it: the
    compiler entry, the game-package template build.mjs patches, and the compatibility runtime
    (`--compatibility`) the compiler copies into public/love/. */
export const LOVE_JS = {
  version: "11.4.1",
  sha256: {
    "index.js": "578f3dab5a33e1d186bce9f77a28f1db05e32b590a2d24f873f9581b35df9ac8",
    "src/game.js": "223c6f5ca7d2bbe47e039f4101f51bab96ccc7e5ad02d4d3281162b28b6ec2c5",
    "src/compat/love.js": "12db012a5cf4e0661f9eaf154c4c10c3cba7a7db31e6a36856028bbaf5f942f0",
    "src/compat/love.wasm": "ecc9e098bb8af918d20fbe3f26d23495c5184ff6b5d203d2e4b27bf17a771d6f",
  },
} as const;

export type LoveJsFile = keyof typeof LOVE_JS.sha256;

export const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** What differs from the pin: the installed version, and each pinned file's hash (undefined for a
    missing file). Empty when love.js matches. */
export function loveJsProblems(
  version: string | undefined,
  hashes: Readonly<Record<LoveJsFile, string | undefined>>,
): string[] {
  const problems: string[] = [];
  if (version !== LOVE_JS.version)
    problems.push(`love.js is ${version ?? "missing a version"}, not ${LOVE_JS.version}`);
  for (const [file, expected] of Object.entries(LOVE_JS.sha256) as [LoveJsFile, string][]) {
    const actual = hashes[file];
    if (actual === undefined) problems.push(`love.js has no ${file}`);
    else if (actual !== expected)
      problems.push(`love.js's ${file} has sha256 ${actual}, not the pinned ${expected}`);
  }
  return problems;
}

/** The source tree as git sees it: its HEAD commit, and whether anything under `resources/` (the
    only part the build copies) differs from that commit. Null when it is not the root of a git
    checkout (a tree inside another repository would report that repository's commit). */
export type SourceCommit = { commit: string; resourcesClean: boolean } | null;

export function sourceCommit(git: (args: readonly string[]) => string | undefined): SourceCommit {
  if (git(["rev-parse", "--show-prefix"])?.trim() !== "") return null;
  const commit = git(["rev-parse", "HEAD"])?.trim();
  if (commit === undefined || !/^[0-9a-f]{40}$/.test(commit)) return null;
  const status = git(["status", "--porcelain", "--", "resources"]);
  return { commit, resourcesClean: status !== undefined && status.trim() === "" };
}

/** Reads love.js under `<source>/node_modules/love.js` and the tree's commit. */
export function readInputs(source: string): {
  problems: string[];
  inputs: { loveJs: typeof LOVE_JS; balatroSource: SourceCommit };
} {
  const dir = join(source, "node_modules/love.js");
  const manifest = join(dir, "package.json");
  const version = existsSync(manifest)
    ? parseJson(readFileSync(manifest, "utf8"), manifest, isRecord).version
    : undefined;
  const hashes = Object.fromEntries(
    Object.keys(LOVE_JS.sha256).map((file) => {
      const path = join(dir, file);
      return [file, existsSync(path) ? sha256(readFileSync(path)) : undefined];
    }),
  ) as Record<LoveJsFile, string | undefined>;
  const git = (args: readonly string[]) => {
    const run = spawnSync("git", ["-C", source, ...args], { encoding: "utf8" });
    return run.status === 0 ? run.stdout : undefined;
  };
  return {
    problems: loveJsProblems(typeof version === "string" ? version : undefined, hashes),
    inputs: { loveJs: LOVE_JS, balatroSource: sourceCommit(git) },
  };
}

function main(): void {
  const source = process.argv[2];
  if (source === undefined) fail("usage: bun scripts/love-inputs.ts <balatro-source>");
  const { problems, inputs } = readInputs(source);
  if (problems.length > 0)
    fail(
      [
        `love-inputs: FAIL — ${source}/node_modules/love.js is not the pinned love.js:`,
        ...problems.map((p) => `  - ${p}`),
        `Reinstall love.js@${LOVE_JS.version} there, or, for a deliberate runtime change, update LOVE_JS in scripts/love-inputs.ts (dependency audit decision 14).`,
      ].join("\n"),
    );
  console.log(JSON.stringify(inputs));
}

if (import.meta.main) main();
